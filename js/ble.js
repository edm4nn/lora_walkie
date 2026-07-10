// Connessione Web Bluetooth al nodo (Nordic UART Service).
// docs/contratto-ble.md: comandi testuali riga-per-riga (\n), chunk in
// uscita ≤180B, riconnessione automatica al ritorno in foreground + GETBUF.

const SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
const RX_CHAR_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e"; // pagina -> nodo
const TX_CHAR_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e"; // nodo -> pagina

const WRITE_CHUNK = 180;

class BleUart extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.rxChar = null;
    this.txChar = null;
    this.connected = false;
    this._lineBuffer = "";
    this._pending = [];
  }

  // Deve essere chiamato da un gesto utente (tap su "Collega nodo").
  async connect() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
    });
    this.device = device;
    device.addEventListener("gattserverdisconnected", () => this._onDisconnected());
    await this._doConnect();
    this._drainBuffer();  // potrebbero già esserci pacchetti in coda dal boot del nodo
    return device;
  }

  // GETBUF e inoltro di ogni pacchetto scaricato come evento "rxpkt".
  async _drainBuffer() {
    try {
      const { packets } = await this.getBuf();
      for (const hex of packets) this.dispatchEvent(new CustomEvent("rxpkt", { detail: hex }));
    } catch (err) {
      // silenzioso: si ritenta alla prossima connessione/riconnessione
    }
  }

  // Riconnette a un device già autorizzato in questa sessione, senza un
  // nuovo prompt di sistema (usato al ritorno in foreground).
  async reconnect() {
    if (!this.device) return false;
    if (this.device.gatt.connected) {
      this.connected = true;
      return true;
    }
    try {
      await this._doConnect();
      return true;
    } catch (err) {
      return false;
    }
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
  }

  async _doConnect() {
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    this.rxChar = await service.getCharacteristic(RX_CHAR_UUID);
    this.txChar = await service.getCharacteristic(TX_CHAR_UUID);

    await this.txChar.startNotifications();
    this.txChar.addEventListener("characteristicvaluechanged", (ev) => this._onNotify(ev));

    this._lineBuffer = "";
    this.connected = true;
    this.dispatchEvent(new CustomEvent("connected"));
  }

  _onDisconnected() {
    this.connected = false;
    for (const req of this._pending.splice(0)) {
      clearTimeout(req.timer);
      req.reject(new Error("BLE disconnesso"));
    }
    this.dispatchEvent(new CustomEvent("disconnected"));
  }

  _onNotify(event) {
    const value = event.target.value;
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    this._lineBuffer += new TextDecoder().decode(bytes);

    let idx;
    while ((idx = this._lineBuffer.indexOf("\n")) >= 0) {
      const line = this._lineBuffer.slice(0, idx).replace(/\r$/, "");
      this._lineBuffer = this._lineBuffer.slice(idx + 1);
      this._handleLine(line);
    }
  }

  _handleLine(line) {
    if (this._pending.length > 0) {
      const req = this._pending[0];
      req.lines.push(line);
      if (req.isDone(req.lines)) {
        this._pending.shift();
        clearTimeout(req.timer);
        req.resolve(req.lines);
      }
      return;
    }
    // Notifica non sollecitata (es. "ID ..." automatico alla connessione).
    this.dispatchEvent(new CustomEvent("line", { detail: line }));
  }

  async _write(line) {
    if (!this.connected || !this.rxChar) throw new Error("BLE non connesso");
    const bytes = new TextEncoder().encode(line + "\n");
    for (let offset = 0; offset < bytes.length; offset += WRITE_CHUNK) {
      await this.rxChar.writeValueWithoutResponse(bytes.slice(offset, offset + WRITE_CHUNK));
    }
  }

  _queueRequest(isDone, timeoutMs) {
    return new Promise((resolve, reject) => {
      const req = { lines: [], isDone, resolve, reject };
      req.timer = setTimeout(() => {
        const idx = this._pending.indexOf(req);
        if (idx >= 0) this._pending.splice(idx, 1);
        reject(new Error("timeout risposta nodo"));
      }, timeoutMs);
      this._pending.push(req);
    });
  }

  // Comandi a risposta singola: WHOAMI, SET_NODE_ID, SET_PRESET,
  // SET_TRANSPORT, STATUS, TXPKT.
  async sendCommand(line, { timeoutMs = 4000 } = {}) {
    const pending = this._queueRequest((lines) => lines.length >= 1, timeoutMs);
    await this._write(line);
    const lines = await pending;
    return lines[0];
  }

  // GETBUF: "BUF <n>" seguito da n righe "RXPKT <hex>".
  async getBuf({ timeoutMs = 8000 } = {}) {
    const pending = this._queueRequest((lines) => {
      if (lines.length === 0) return false;
      const m = /^BUF (\d+)$/.exec(lines[0]);
      const expected = m ? parseInt(m[1], 10) : 0;
      return lines.length >= 1 + expected;
    }, timeoutMs);

    await this._write("GETBUF");
    const lines = await pending;
    const count = parseInt(/^BUF (\d+)$/.exec(lines[0])?.[1] ?? "0", 10);
    const packets = lines.slice(1).map((l) => l.replace(/^RXPKT /, ""));
    return { count, packets };
  }
}

export const ble = new BleUart();

// Riconnessione automatica al ritorno in foreground (contratto BLE:
// le PWA sospese perdono il BLE), seguita da GETBUF per lo svuotamento
// del buffer accumulato dal nodo.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  if (!ble.device || ble.connected) return;

  ble.reconnect().then((ok) => {
    if (ok) ble._drainBuffer();
  });
});
