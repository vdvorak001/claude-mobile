"use strict";

/**
 * push.js — Web Push subscription management via ntfy.sh VAPID.
 * Handles subscribe, unsubscribe, and topic updates.
 * Requires service worker with push event handler.
 */
const Push = (() => {
  const NTFY_BASE = "https://ntfy.sh";
  let _vapidKey = null;

  /** Check if Web Push is supported in this browser. */
  function isSupported() {
    return (
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window
    );
  }

  /** Fetch ntfy.sh VAPID public key (cached after first call). */
  async function _getVapidKey() {
    if (_vapidKey) return _vapidKey;
    const res = await fetch(`${NTFY_BASE}/v1/config`);
    if (!res.ok) throw new Error(`ntfy config fetch failed: ${res.status}`);
    const cfg = await res.json();
    if (!cfg.web_push_public_key) throw new Error("ntfy Web Push not enabled");
    _vapidKey = cfg.web_push_public_key;
    return _vapidKey;
  }

  /** Convert URL-safe base64 string to Uint8Array (for applicationServerKey). */
  function _urlBase64ToUint8Array(base64) {
    const padding = "=".repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(b64);
    return new Uint8Array([...raw].map((c) => c.charCodeAt(0)));
  }

  /** Convert ArrayBuffer to base64 string. */
  function _bufToBase64(buf) {
    return btoa(String.fromCharCode(...new Uint8Array(buf)));
  }

  /**
   * Subscribe to Web Push for the given ntfy.sh topics.
   * Requests Notification permission if not already granted.
   * @param {string[]} topics — ntfy.sh topic names to subscribe to
   * @returns {Promise<PushSubscription>}
   */
  async function subscribe(topics) {
    if (!isSupported()) throw new Error("Web Push not supported");

    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Notification permission denied");

    const swReg = await navigator.serviceWorker.ready;
    const vapidKey = await _getVapidKey();

    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: _urlBase64ToUint8Array(vapidKey),
    });

    await _registerWithNtfy(sub, topics);
    return sub;
  }

  /**
   * Update subscribed topics without triggering a new permission prompt.
   * Reuses existing PushSubscription; re-registers it with ntfy.sh.
   * @param {string[]} topics
   */
  async function updateTopics(topics) {
    const swReg = await navigator.serviceWorker.ready;
    const sub = await swReg.pushManager.getSubscription();
    if (!sub) return;
    await _registerWithNtfy(sub, topics);
  }

  /** Send PushSubscription + topics to ntfy.sh /v1/webpush. */
  async function _registerWithNtfy(sub, topics) {
    const key = sub.getKey("p256dh");
    const auth = sub.getKey("auth");

    const res = await fetch(`${NTFY_BASE}/v1/webpush`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: sub.endpoint,
        p256dh: _bufToBase64(key),
        auth: _bufToBase64(auth),
        topics,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`ntfy webpush registration failed ${res.status}: ${text}`);
    }
  }

  /**
   * Unsubscribe from Web Push — removes subscription from browser and ntfy.sh.
   */
  async function unsubscribe() {
    const swReg = await navigator.serviceWorker.ready;
    const sub = await swReg.pushManager.getSubscription();
    if (!sub) return;

    // Notify ntfy.sh to remove this endpoint
    await fetch(`${NTFY_BASE}/v1/webpush`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => { /* best-effort */ });

    await sub.unsubscribe();
  }

  /**
   * Check if browser currently has an active push subscription.
   * @returns {Promise<boolean>}
   */
  async function isSubscribed() {
    if (!isSupported()) return false;
    try {
      const swReg = await navigator.serviceWorker.ready;
      const sub = await swReg.pushManager.getSubscription();
      return !!sub;
    } catch {
      return false;
    }
  }

  return { isSupported, subscribe, unsubscribe, updateTopics, isSubscribed };
})();
