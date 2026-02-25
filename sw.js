const CACHE_NAME = "claude-mobile-v4";
const STATIC_ASSETS = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/ntfy.js",
  "./js/push.js",
  "./js/ui.js",
  "./manifest.json",
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

// ── Web Push ──

self.addEventListener("push", (e) => {
  if (!e.data) return;

  let title = "Claude Mobile";
  let body = "";
  let tag = "claude-push";
  let requireInteraction = false;

  try {
    const payload = e.data.json();

    // Handle subscription expiry warning
    if (payload.event === "subscription_expiring") {
      title = "Claude Mobile — Push expiruje";
      body = "Obnov Web Push v nastavení aplikace.";
      tag = "push-expiry";
    } else {
      // Normal message payload
      const msg = payload.message || payload;
      if (!msg || (msg.event && msg.event !== "message")) return;

      title = msg.title || "Claude Mobile";
      body = msg.message || "";
      tag = msg.id || "claude-push";
      // Require interaction for actionable types (approve/choice/permission)
      const tags = msg.tags || [];
      requireInteraction =
        tags.includes("question") ||
        tags.includes("lock") ||
        tags.includes("point_right");
    }
  } catch {
    body = e.data.text();
  }

  e.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon: "./icons/icon-192.png",
        badge: "./icons/icon-192.png",
        tag,
        requireInteraction,
        vibrate: [200, 100, 200],
        data: { url: self.registration.scope },
      }),
      // Wake up any open client windows so they reconnect and fetch messages
      clients.matchAll({ type: "window" }).then((list) => {
        for (const client of list) {
          client.postMessage({ type: "push-received" });
        }
      }),
    ])
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if (client.url.startsWith(self.registration.scope) && "focus" in client) {
            return client.focus();
          }
        }
        return clients.openWindow(self.registration.scope);
      })
  );
});
