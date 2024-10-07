// service-worker.js
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open("nostrsync-cache").then((cache) => {
      return cache.addAll([
        "/",
        "/index.html",
        "/style.css",
        // Add more files to cache here
      ]);
    })
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
