// Mirror JS dell'header del pacchetto MeshSRP (docs/contratto-ble.md v0.4,
// 13B in chiaro) — vedi anche firmware/meshsrp_node/packet.h/.cpp, stessa
// struttura e stesso ordine dei campi, big-endian per i campi multi-byte.

export const HEADER_LEN = 13;
export const GCM_TAG_LEN = 16;
export const MAX_PACKET_LEN = 255;

export function buildHeader({
  version,
  msgType,
  srcId,
  dstId,
  groupId,
  seqNum,
  ttl,
  fragIdx,
  fragTotal,
  payloadLen,
}) {
  const buf = new Uint8Array(HEADER_LEN);
  buf[0] = version & 0xff;
  buf[1] = msgType & 0xff;
  buf[2] = (srcId >> 8) & 0xff;
  buf[3] = srcId & 0xff;
  buf[4] = (dstId >> 8) & 0xff;
  buf[5] = dstId & 0xff;
  buf[6] = groupId & 0xff;
  buf[7] = (seqNum >> 8) & 0xff;
  buf[8] = seqNum & 0xff;
  buf[9] = ttl & 0xff;
  buf[10] = fragIdx & 0xff;
  buf[11] = fragTotal & 0xff;
  buf[12] = payloadLen & 0xff;
  return buf;
}

// null se troppo corto o se PAYLOAD_LEN dichiarato non combacia con la
// lunghezza totale (stessa validazione di Packet::parseHeader in C++).
export function parseHeader(bytes) {
  if (bytes.length < HEADER_LEN + GCM_TAG_LEN) return null;

  const header = {
    version: bytes[0],
    msgType: bytes[1],
    srcId: (bytes[2] << 8) | bytes[3],
    dstId: (bytes[4] << 8) | bytes[5],
    groupId: bytes[6],
    seqNum: (bytes[7] << 8) | bytes[8],
    ttl: bytes[9],
    fragIdx: bytes[10],
    fragTotal: bytes[11],
    payloadLen: bytes[12],
  };

  const expectedLen = HEADER_LEN + header.payloadLen + GCM_TAG_LEN;
  if (expectedLen !== bytes.length) return null;

  return header;
}

export function buildPacket(fields, payload, tag) {
  const header = buildHeader({ ...fields, payloadLen: payload.length });
  const packet = new Uint8Array(HEADER_LEN + payload.length + GCM_TAG_LEN);
  packet.set(header, 0);
  packet.set(payload, HEADER_LEN);
  packet.set(tag, HEADER_LEN + payload.length);
  return packet;
}

// null se l'header non è valido (vedi parseHeader).
export function splitPacket(bytes) {
  const header = parseHeader(bytes);
  if (!header) return null;

  const payload = bytes.slice(HEADER_LEN, HEADER_LEN + header.payloadLen);
  const tag = bytes.slice(HEADER_LEN + header.payloadLen);
  return { header, payload, tag };
}

const HEX_DIGITS = "0123456789ABCDEF";

export function hexEncode(bytes) {
  let out = "";
  for (const b of bytes) {
    out += HEX_DIGITS[(b >> 4) & 0xf];
    out += HEX_DIGITS[b & 0xf];
  }
  return out;
}

export function hexDecode(hex) {
  if (hex.length % 2 !== 0) throw new Error("hex di lunghezza dispari");

  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) throw new Error("hex non valido");
    out[i] = byte;
  }
  return out;
}
