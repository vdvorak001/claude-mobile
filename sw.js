const CACHE_NAME = "claude-mobile-v1";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/css/style.css",
  "/js/app.js",
  "/js/ntfy.js",
  "/js/ui.js",
  "/manifest.json",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Network-first for ntfy.sh (real-time data)
  if (url.hostname === "ntfy.sh") {
    e.respondWith(fetch(e.request));
    return;
  }

  // Cache-first for static assets
  e.respondWith(
    caches
      .match(e.request)
      .then((cached) => cached || fetch(e.request))
  );
});
