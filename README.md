[README.md](https://github.com/user-attachments/files/29673014/README.md)
<div align="center">

<img src="logo.png" alt="Walkie LoRa" width="260">

# Walkie LoRa

**Rete di comunicazione privata, cifrata, senza internet — ESP32 + LoRa + Bluetooth**

*Talk. Connect. Anywhere.*

![status](https://img.shields.io/badge/status-in%20sviluppo-yellow)
![platform](https://img.shields.io/badge/platform-ESP32-blue)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

</div>

---

## Cos'è

Walkie LoRa è una rete privata di dispositivi ESP32 + modulo LoRa **DX-LR02** che si scambiano messaggi di testo **cifrati** (AES-128-GCM) senza alcuna infrastruttura: niente SIM, niente internet, niente server. Ogni dispositivo si controlla dal telefono tramite un'app web (Web Bluetooth), installabile come PWA e funzionante **offline** dopo il primo avvio.

Nato come alternativa più semplice a Meshtastic per l'uso "io e te, pochi dispositivi": firmware identico su ogni nodo, identità assegnata dall'app, chiave di cifratura tua e condivisa solo tra i tuoi apparati.

## Caratteristiche

- 🔒 **Cifratura end-to-end AES-128-GCM** — solo chi possiede la chiave decifra; tag di autenticazione contro manomissioni
- 📻 **Comunicazione punto-punto o broadcast** — messaggio diretto con conferma (ACK+retry), o a tutta la rete
- 🧩 **Firmware identico su ogni nodo** — indirizzo e nome si assegnano dall'app, non nel codice
- 📖 **Rubrica auto-appresa** — i dispositivi si annunciano a vicenda, l'app li mostra per nome
- 📱 **App PWA offline** — Web Bluetooth, installabile in un tap, nessuna connessione richiesta dopo il primo avvio
- 🛡️ **Anti-replay** — contatore per mittente persistito in NVS
- 🔌 **Estendibile** — tipi di messaggio già riservati per fase 2 (controllo relè, servo, sensori)

## Architettura

```
Telefono ──BLE──> ESP32 ──UART/AT──> DX-LR02 ~~~ radio 868 MHz ~~~ DX-LR02 <──UART── ESP32 <──BLE── Telefono
```

L'ESP32 fa da modem cifrante: riceve testo dall'app via Bluetooth, lo impacchetta e cifra, lo passa al modulo LoRa che lo trasmette in modalità trasparente. Nessun routing mesh per ora — punto-punto diretto o broadcast, con ACK e ritrasmissione per i messaggi diretti.

### Formato del frame radio

```
[MAGIC 2B][VER][SRC][DST][TYPE][HOPS][CTR 4B][LEN][payload cifrato][TAG 8B]
```

| Campo | Descrizione |
|---|---|
| `MAGIC` | identifica i frame del protocollo, scarta rumore/altri dispositivi |
| `SRC` / `DST` | indirizzo mittente / destinatario (`0xFF` = broadcast) |
| `TYPE` | `MSG` `ACK` `PING` `PONG` `HELLO` · riservati `CMD` `STATE` `DESC` per fase 2 |
| `CTR` | contatore monotono: nonce di cifratura + anti-replay |
| `HOPS` | predisposto per un futuro nodo repeater (non ancora attivo) |
| `TAG` | tag di autenticazione AES-GCM (8 byte) |

Cifratura: **AES-128-GCM** via mbedTLS (accelerato in HW su ESP32), header come dato autenticato (AAD).

## Hardware

Per ogni apparato:

- ESP32 con Bluetooth (es. **Seeed XIAO ESP32S3**, **ESP32-C5 DevKit**) — no ESP32-S2, non ha BLE
- Modulo **DX-LR02** (LoRa, chip ASR6601, UART trasparente) + antenna
- Cablaggio: `VCC→3.3V` `GND→GND` `TXD→RX` `RXD→TX` (incrociati)

I pin UART esatti dipendono dalla scheda — vedi commenti in cima a [`firmware/walkie_lora_firmware.ino`](firmware/walkie_lora_firmware.ino).

## Struttura del repository

```
firmware/
  walkie_lora_firmware.ino     firmware ESP32 (BLE + AES-GCM + ACK/retry + DX-LR02)
  test_bridge_seriale.ino      sketch di debug: bridge USB <-> modulo LoRa
app/
  index.html                   app PWA (Web Bluetooth)
  manifest.json
  icon.svg
  service-worker.js
assets/
  logo.png
docs/
  ...
```

## Avvio rapido

### 1. Firmware

1. Apri `firmware/walkie_lora_firmware.ino` in Arduino IDE (board package **esp32 by Espressif**)
2. Genera una chiave tua: `openssl rand -hex 16` e incollala in `KEY[16]`
3. Imposta i pin UART corretti per la tua scheda (vedi commenti nel file)
4. Flasha **lo stesso identico sketch** su ogni dispositivo — cambia solo `KEY` una volta per tutta la rete

### 2. App

L'app richiede un contesto **https** solo alla primissima apertura (permesso Web Bluetooth del browser); dopo resta salvata sul telefono e funziona offline.

1. Pubblica la cartella `app/` su GitHub Pages o Netlify Drop
2. Apri il link con **Chrome su Android** (Web Bluetooth non esiste su iOS/Safari)
3. Menu → "Aggiungi a schermata Home"

### 3. Primo utilizzo

1. Collega, assegna un indirizzo (1-254) e un nome a ogni apparato
2. Scegli il destinatario dal menu "A:" — un nodo preciso o "Tutti"
3. Scrivi e invia — una spunta = trasmesso, due spunte verdi = confermato

## Stato del progetto

🚧 **In sviluppo attivo.** Attualmente in debug: il modulo DX-LR02 scambia dati correttamente in modalità trasparente pura (verificato con tool esterni), ma il firmware con cifratura non riceve ancora messaggi tra i nodi — problema isolato nello strato applicativo (framing o AES-GCM), non nell'hardware radio. Vedi [Issues](../../issues) per lo stato del debug.

## Roadmap

- [x] Protocollo cifrato con ACK/retry/anti-replay
- [x] App PWA con rubrica e broadcast/diretto
- [ ] Risoluzione bug ricezione firmware ↔ DX-LR02
- [ ] Verifica portata reale e duty cycle ETSI
- [ ] Nodo repeater (uso del campo `HOPS`)
- [ ] I/O modulari: comandi `CMD`/`STATE`/`DESC` per relè, servo, sensori con auto-descrizione

## Note legali

Banda 868 MHz (Europa): rispetta i limiti di duty cycle ETSI (~1%) e potenza. La cifratura è consentita sulle bande ISM; è invece vietata sulle bande radioamatoriali.

## Licenza

MIT — vedi [`LICENSE`](LICENSE)
