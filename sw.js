const STATIC_CACHE = "nostrsync-static-v2";
const RUNTIME_CACHE = "nostrsync-runtime-v2";

const APP_SHELL = [
  "/",
  "/index.html",
  "/manifest.json",
  "/icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/trustedrelays.json",
  "/nostrnet/style.css",
  "/js/nostr-utils.js",
  "/js/nostr-broadcast.js",
  "/js/relays.js",
  "/js/pwa.js",
  "/nostrdb/index.html",
  "/nostrdb/script.js",
  "/nostrnet/nostrnet.html",
  "/nostrnet/database.html",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

const networkFirst = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE);

  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    return (await cache.match(request)) || caches.match("/index.html");
  }
};

const staleWhileRevalidate = async (request) => {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  const networkPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);

  return cached || networkPromise;
};

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (event.request.mode === "navigate") {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event.request));
  }
});