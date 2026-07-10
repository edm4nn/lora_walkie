// Cache-first: dopo la prima visita online, l'app funziona interamente
// offline (nessuna risorsa runtime da CDN: tutto è locale al repo).

const CACHE_VERSION = "v4";
const CACHE_NAME = `meshsrp-${CACHE_VERSION}`;

const PRECACHE_URLS = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/style.css",
  "js/app.js",
  "js/ble.js",
  "js/db.js",
  "js/crypto.js",
  "js/packet.js",
  "js/messaging.js",
  "js/tabs/chat.js",
  "js/tabs/maps.js",
  "js/tabs/sensors.js",
  "js/tabs/settings.js",
  "icons/icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
    })
  );
});
