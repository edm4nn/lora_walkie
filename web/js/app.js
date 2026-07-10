import { ble } from "./ble.js";
import { getSetting } from "./db.js";
import * as chatTab from "./tabs/chat.js";
import * as mapsTab from "./tabs/maps.js";
import * as sensorsTab from "./tabs/sensors.js";
import * as settingsTab from "./tabs/settings.js";

const TABS = {
  chat: chatTab,
  maps: mapsTab,
  sensors: sensorsTab,
  settings: settingsTab,
};

const tabContent = document.getElementById("tab-content");
const tabButtons = document.querySelectorAll(".tab-btn");
const statusDot = document.getElementById("status-ble-dot");
const statusLabel = document.getElementById("status-node-label");
const testBanner = document.getElementById("status-test-banner");

let currentTabHandle = null;
let currentTabName = null;

async function switchTab(name) {
  if (name === currentTabName || !TABS[name]) return;
  if (currentTabHandle && currentTabHandle.onUnmount) currentTabHandle.onUnmount();

  tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === name));
  currentTabHandle = (await TABS[name].mount(tabContent)) || null;
  currentTabName = name;
}

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

// ---- stato BLE nella status bar ----

function updateBleStatus(connected) {
  statusDot.classList.toggle("connected", connected);
  statusLabel.classList.toggle("connected", connected);
  if (!connected) statusLabel.textContent = "Nodo non collegato";
}

// Niente WHOAMI attivo qui: il nodo manda già "ID ..." da solo appena
// connesso (vedi ble.js), ci limitiamo ad ascoltarlo.
ble.addEventListener("identity", (ev) => {
  const { id, name } = ev.detail;
  statusLabel.textContent = `${id} · ${name}`;
});

ble.addEventListener("connected", () => updateBleStatus(true));
ble.addEventListener("disconnected", () => updateBleStatus(false));
updateBleStatus(ble.connected);

// ---- banner "MODALITÀ TEST" per il trasporto forzato ----

function updateTransportBanner(transport) {
  const isTest = transport && transport !== "AUTO";
  testBanner.hidden = !isTest;
  if (isTest) testBanner.textContent = `TEST: ${transport}`;
}

window.addEventListener("meshsrp:transport-changed", (ev) => updateTransportBanner(ev.detail));
getSetting("transport", "AUTO").then(updateTransportBanner);

// ---- Wake Lock durante l'uso attivo (nodo connesso) ----

let wakeLock = null;

async function requestWakeLock() {
  if (!("wakeLock" in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request("screen");
    wakeLock.addEventListener("release", () => {
      wakeLock = null;
    });
  } catch (err) {
    // permesso negato o pagina non visibile: non bloccante per l'app
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

ble.addEventListener("connected", requestWakeLock);
ble.addEventListener("disconnected", releaseWakeLock);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ble.connected && !wakeLock) {
    requestWakeLock();
  }
});

// ---- service worker (offline dopo la prima visita) ----

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {
      // ambiente di sviluppo senza HTTPS/localhost: non bloccante
    });
  });
}

switchTab("chat");
