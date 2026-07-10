// Chiave di squadra (AES-128-GCM) e cifratura/decifratura per-frammento.
//
// Convenzione PWA-interna (non fa parte di docs/contratto-ble.md, che
// riguarda solo l'interfaccia pagina↔nodo: per il nodo il PAYLOAD è
// comunque un blob opaco): ogni frammento ha il proprio nonce casuale,
// per evitare qualunque rischio di riuso IV con la stessa chiave.
//   PAYLOAD (opaco, dentro il pacchetto) = IV (12B) || ciphertext
//   GCM_TAG (16B, campo separato dell'header) = tag di autenticazione
//
// In questa milestone esiste un solo team di default ("TUTTI",
// GROUP_ID=0): niente creazione squadre/admin/QR, la chiave è generata
// al primo utilizzo e salvata in IndexedDB (store "teams").

import { dbGet, dbPut } from "./db.js";

export const IV_LEN = 12;
const GCM_TAG_LEN = 16;
const DEFAULT_TEAM_NAME = "TUTTI";

export async function getOrCreateTeamKey(groupId = 0) {
  const existing = await dbGet("teams", groupId);
  if (existing) return existing.key;

  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, true, [
    "encrypt",
    "decrypt",
  ]);
  await dbPut("teams", { groupId, name: DEFAULT_TEAM_NAME, key, createdAt: Date.now() });
  return key;
}

// Cifra un chunk di plaintext; ritorna { payload, tag } pronti per essere
// piazzati nei campi PAYLOAD/GCM_TAG del pacchetto.
export async function encryptChunk(key, plaintextBytes) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const cipherWithTag = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintextBytes)
  );

  const ciphertext = cipherWithTag.slice(0, cipherWithTag.length - GCM_TAG_LEN);
  const tag = cipherWithTag.slice(cipherWithTag.length - GCM_TAG_LEN);

  const payload = new Uint8Array(IV_LEN + ciphertext.length);
  payload.set(iv, 0);
  payload.set(ciphertext, IV_LEN);

  return { payload, tag };
}

// Decifra un frammento dati i campi PAYLOAD/GCM_TAG letti dal pacchetto.
export async function decryptChunk(key, payload, tag) {
  const iv = payload.slice(0, IV_LEN);
  const ciphertext = payload.slice(IV_LEN);

  const cipherWithTag = new Uint8Array(ciphertext.length + tag.length);
  cipherWithTag.set(ciphertext, 0);
  cipherWithTag.set(tag, ciphertext.length);

  const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherWithTag);
  return new Uint8Array(plainBuf);
}
