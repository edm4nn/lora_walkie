<div align="center">

<img src="assets/icon-192.png" alt="MeshSRP logo" width="514" height="514">

# MeshSRP

**Chat broadcast privata su rete LoRa** — Short Range Protocol

</div>

<br>

## Cos'è

MeshSRP è una chat broadcast privata e cifrata su rete LoRa. Nodi **ESP32-S3**
(Heltec WiFi LoRa 32 V3, chip radio SX1262) comunicano tra loro via LoRa; ogni nodo
si collega a un telefono via **Bluetooth Low Energy** attraverso una PWA, con
pairing sicuro a conferma visiva (codice a 6 cifre confrontato tra l'OLED del nodo
e lo schermo del telefono).

## Architettura

```
Telefono (PWA, Web Bluetooth)
   │  BLE, cifrato con chiave di sessione (AES-256-GCM)
   ▼
Nodo ESP32-S3 (firmware Arduino, modulare)
   │  LoRa, cifrato con chiave di rete condivisa (AES-256-GCM)
   ▼
Altri nodi della stessa rete
```

Due livelli di cifratura distinti e indipendenti:

| Livello | Chiave | Derivazione |
|---|---|---|
| BLE (telefono ↔ nodo) | chiave di sessione | X25519 (ECDH) + BLAKE2b, stabilita al pairing, ruota periodicamente |
| LoRa (nodo ↔ nodo) | chiave di rete simmetrica | derivata da una passphrase condivisa (`NETWORK_PASSWORD`), uguale su tutti i nodi della rete |

## Stato attuale

Funzionalità verificate:

- [x] Pairing BLE con conferma visiva del codice
- [x] Persistenza del trust tra riconnessioni (niente ceremony ripetuta)
- [x] Invio/ricezione messaggi cifrati end-to-end (telefono → nodo → LoRa → nodo → telefono)
- [x] PWA installabile, funziona offline (solo Android — Web Bluetooth non è disponibile su iOS)
- [x] Spreading Factor (7/9/12) configurabile a runtime
- [x] Duty cycle EU868 calcolato e applicato (blocca trasmissioni oltre l'1% orario)

> ⚠️ **Nota di sicurezza**: i log di debug aggiunti durante lo sviluppo stampano
> attualmente dati sensibili in chiaro (chiavi private, shared secret, session key)
> su seriale e console browser. Rimuoverli è la priorità assoluta prima di qualunque
> uso reale — vedi [Piano di lavoro](#piano-di-lavoro).

## Struttura del progetto

```
firmware/
  firmware.ino          setup()/loop(), entry point
  config.h               pin, costanti, default (SF, TTL, duty cycle, timing)
  crypto.h / .cpp          X25519 (via libreria "Crypto"), BLAKE2b, AES-256-GCM (mbedtls)
  storage.h / .cpp         NVS: identità nodo, trust telefono, contatori, SF, nickname
  lora_link.h / .cpp        radio SX1262, SF runtime, duty cycle, cifratura broadcast
  chat_protocol.h / .cpp     formato messaggi, anti-replay, relay multi-hop, buffer offline
  oled_ui.h / .cpp           display (Adafruit SSD1306/GFX)
  ble_service.h / .cpp        pairing BLE, canale chat, config runtime (SF/nickname)

pwa/
  index.html, app.css, app.js   UI + Web Bluetooth + crypto lato client
  manifest.json, sw.js            PWA installabile, cache offline
  icons/                           dal logo del progetto
```

## Hardware

- **Heltec WiFi LoRa 32 V3** (ESP32-S3 + SX1262)
- Sulle board **V3.2** il TCXO on-board va alimentato esplicitamente (assente su V3.0/V3.1)
- Display OLED collegato al pin **Vext (GPIO 36)**: va acceso esplicitamente (LOW) prima di `display.begin()`

## Piano di lavoro

L'ordine riflette una priorità: prima chiudere le falle di sicurezza note, poi
consolidare l'affidabilità della configurazione a 2 nodi prima di introdurre la
complessità del multi-hop.

1. **Rimozione dei log di debug sensibili** — rischio di sicurezza concreto, da fare per primo
2. Un secondo ciclo di test end-to-end pulito, senza log di debug
3. Test con un terzo nodo per validare il relay multi-hop (TTL, anti-replay)
4. Verifica duty cycle e cambio SF sotto carico reale
5. Roadmap v2: ACK espliciti, validazione buffer offline, discovery di rete, firma per-messaggio

## Vincoli di design

Scelte esplicite, non limiti tecnici — da rispettare in qualunque refactor futuro:

- **Un solo telefono fidato per nodo alla volta** (non multi-device)
- **Password di rete condivisa** per il livello LoRa, non chiavi per-nodo (trade-off di sicurezza noto e accettato: la compromissione di un nodo espone la rete)
- **Nessuna operazione bloccante o crittograficamente pesante dentro i callback BLE** — pattern a coda + processing nel `loop()` principale
- **Payload binari sempre via `getData()`/`getLength()`**, mai `String`, sulle characteristic BLE

## Licenza

_Da definire._

