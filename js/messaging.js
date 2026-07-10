// Orchestrazione invio/ricezione chat: frammentazione, cifratura,
// TXPKT/RXPKT, persistenza IndexedDB, TTS in arrivo.
//
// Milestone attuale: un solo canale di default "TUTTI" (GROUP_ID=0,
// vedi js/crypto.js). Nessun sistema squadre/admin ancora.

import { ble } from "./ble.js";
import { getOrCreateTeamKey, encryptChunk, decryptChunk, IV_LEN } from "./crypto.js";
import * as Packet from "./packet.js";
import { addMessage, updateMessage, getMessagesByGroup, getSetting, setSetting } from "./db.js";

export const DEFAULT_GROUP_ID = 0;

const DST_BROADCAST = 0xffff;
const MSG_TYPE_TEXT = 0x01;
const VERSION_NO_COMPRESSION = 0x01; // bit7=0: compressione rimandata a Fase 1.5
const DEFAULT_TTL = 4; // nessun relay reale da calibrare ancora, placeholder documentato
const MAX_FRAGMENT_PLAINTEXT =
  Packet.MAX_PACKET_LEN - Packet.HEADER_LEN - Packet.GCM_TAG_LEN - IV_LEN; // 214B

export const messagingEvents = new EventTarget();
function notifyChange() {
  messagingEvents.dispatchEvent(new CustomEvent("change"));
}

// Divide il testo in chunk che, una volta cifrati, stanno in un frammento
// radio (≤214B di plaintext). Itera per code point (Array.from) per non
// spezzare mai un carattere multi-byte (es. emoji) a metà.
function splitIntoChunks(text, maxBytes) {
  const encoder = new TextEncoder();
  const chunks = [];
  let current = "";
  let currentBytes = 0;

  for (const ch of Array.from(text)) {
    const chBytes = encoder.encode(ch).length;
    if (currentBytes + chBytes > maxBytes && current.length > 0) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += ch;
    currentBytes += chBytes;
  }
  chunks.push(current); // anche se vuoto: un messaggio vuoto resta un frammento

  return chunks;
}

async function nextSeqNum() {
  const current = await getSetting("txSeqCounter", 0);
  const next = (current + 1) % 65536;
  await setSetting("txSeqCounter", next);
  return next;
}

export async function canSend() {
  if (!ble.connected) return { ok: false, reason: "Nodo non connesso." };

  const myNode = await getSetting("lastKnownNode", null);
  if (!myNode || myNode.name === "UNCONFIGURED") {
    return { ok: false, reason: "Nodo non ancora provisionato (vai su Impostazioni)." };
  }
  return { ok: true, srcId: parseInt(myNode.id, 10) };
}

export async function sendText(text) {
  const ready = await canSend();
  if (!ready.ok) throw new Error(ready.reason);

  const srcId = ready.srcId;
  const key = await getOrCreateTeamKey(DEFAULT_GROUP_ID);
  const seqNum = await nextSeqNum();
  const chunks = splitIntoChunks(text, MAX_FRAGMENT_PLAINTEXT);
  const fragTotal = chunks.length;

  const record = {
    groupId: DEFAULT_GROUP_ID,
    direction: "out",
    srcId,
    text,
    timestamp: Date.now(),
    seqNum,
    state: "sending",
  };
  record.id = await addMessage(record);
  notifyChange();

  try {
    for (let i = 0; i < chunks.length; i++) {
      const plaintextBytes = new TextEncoder().encode(chunks[i]);
      const { payload, tag } = await encryptChunk(key, plaintextBytes);

      const packetBytes = Packet.buildPacket(
        {
          version: VERSION_NO_COMPRESSION,
          msgType: MSG_TYPE_TEXT,
          srcId,
          dstId: DST_BROADCAST,
          groupId: DEFAULT_GROUP_ID,
          seqNum,
          ttl: DEFAULT_TTL,
          fragIdx: i,
          fragTotal,
        },
        payload,
        tag
      );

      const hex = Packet.hexEncode(packetBytes);
      const reply = await ble.sendCommand(`TXPKT ${hex}`);
      if (!reply.startsWith("SENT")) {
        throw new Error(`Nodo ha rifiutato il frammento ${i + 1}/${fragTotal}: ${reply}`);
      }
    }
    record.state = "sent";
  } catch (err) {
    record.state = "fail";
    await updateMessage(record);
    notifyChange();
    throw err;
  }

  await updateMessage(record);
  notifyChange();
}

export async function getMessages() {
  const msgs = await getMessagesByGroup(DEFAULT_GROUP_ID);
  return msgs.sort((a, b) => a.timestamp - b.timestamp);
}

// ---- ricezione ----
//
// reassemblyBuffers: (srcId,seqNum) -> frammenti raccolti finché non ne
// arrivano fragTotal. Ogni frammento è cifrato/autenticato per conto
// proprio (vedi js/crypto.js), quindi si decifra man mano che arriva,
// senza dover aspettare gli altri prima di poterlo leggere.
const reassemblyBuffers = new Map();

function speakIncoming(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "it-IT";
  speechSynthesis.speak(utterance);
}

async function finalizeIncomingMessage(header, text) {
  const record = {
    groupId: header.groupId,
    direction: "in",
    srcId: header.srcId,
    text,
    timestamp: Date.now(),
    seqNum: header.seqNum,
    state: "received",
  };
  record.id = await addMessage(record);
  notifyChange();
  speakIncoming(text);
}

function addFragment(header, chunkText) {
  const key = `${header.srcId}:${header.seqNum}`;
  let entry = reassemblyBuffers.get(key);
  if (!entry) {
    entry = { fragTotal: header.fragTotal, parts: new Map() };
    reassemblyBuffers.set(key, entry);
  }
  entry.parts.set(header.fragIdx, chunkText);

  if (entry.parts.size < entry.fragTotal) return; // mancano altri frammenti

  reassemblyBuffers.delete(key);
  const fullText = Array.from({ length: entry.fragTotal }, (_, i) => entry.parts.get(i) ?? "").join("");
  finalizeIncomingMessage(header, fullText);
}

async function handleIncomingHex(hex) {
  try {
    const bytes = Packet.hexDecode(hex);
    const split = Packet.splitPacket(bytes);
    if (!split) return; // pacchetto malformato: scartato

    const { header, payload, tag } = split;
    if (header.groupId !== DEFAULT_GROUP_ID) return; // altro canale, non gestito in questa milestone
    if (header.msgType !== MSG_TYPE_TEXT) return; // altri MSG_TYPE non gestiti dalla chat

    const key = await getOrCreateTeamKey(header.groupId);
    const plaintextBytes = await decryptChunk(key, payload, tag);
    const chunkText = new TextDecoder().decode(plaintextBytes);

    addFragment(header, chunkText);
  } catch (err) {
    console.warn("Pacchetto in ricezione scartato:", err);
  }
}

// Due percorsi convergono qui: pacchetti scaricati da GETBUF (evento
// "rxpkt" da ble.js) e, in futuro con la radio reale, notifiche RXPKT
// non sollecitate (evento generico "line" di ble.js).
ble.addEventListener("rxpkt", (ev) => handleIncomingHex(ev.detail));
ble.addEventListener("line", (ev) => {
  const line = ev.detail;
  if (line.startsWith("RXPKT ")) handleIncomingHex(line.slice("RXPKT ".length));
});
