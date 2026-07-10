// IndexedDB — schema completo del progetto (docs/spec.md: chiavi di
// squadra, chiave admin, cronologia messaggi, rubrica, impostazioni).
// In questa milestone si legge/scrive solo "settings"; gli altri store
// sono creati ora per non dover fare una migrazione di schema dopo.

const DB_NAME = "meshsrp";
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains("settings")) {
        db.createObjectStore("settings", { keyPath: "key" });
      }
      if (!db.objectStoreNames.contains("teams")) {
        db.createObjectStore("teams", { keyPath: "groupId" });
      }
      if (!db.objectStoreNames.contains("messages")) {
        const messages = db.createObjectStore("messages", {
          keyPath: "id",
          autoIncrement: true,
        });
        messages.createIndex("byGroup", "groupId");
      }
      if (!db.objectStoreNames.contains("contacts")) {
        db.createObjectStore("contacts", { keyPath: "srcId" });
      }
      if (!db.objectStoreNames.contains("adminKey")) {
        db.createObjectStore("adminKey", { keyPath: "key" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

async function dbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function dbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getSetting(key, fallback = undefined) {
  const record = await dbGet("settings", key);
  return record ? record.value : fallback;
}

export async function setSetting(key, value) {
  await dbPut("settings", { key, value });
}

// record senza "id": lo store è autoIncrement, ritorna l'id generato.
export async function addMessage(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readwrite");
    const req = tx.objectStore("messages").add(record);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// record deve includere "id" (es. per transizioni di stato sending->sent).
export async function updateMessage(record) {
  await dbPut("messages", record);
}

export async function getMessagesByGroup(groupId) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("messages", "readonly");
    const req = tx.objectStore("messages").index("byGroup").getAll(groupId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export { dbGet, dbPut };
