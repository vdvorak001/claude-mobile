"use strict";

/**
 * app.js — Main orchestrator for Claude Mobile PWA.
 * Connects Ntfy, UI rendering, navigation, settings, history.
 */
const App = (() => {
  const HISTORY_KEY = "claude_mobile_history";
  const SETTINGS_KEY = "claude_mobile_settings";
  const MAX_HISTORY = 100;
  const SEEN_KEY = "claude_mobile_seen";

  let notifications = [];
  let seenIds = new Set();
  let settings = {
    topic: "vladimir-claude-x7k9m",
    replyTopic: "vladimir-claude-reply-x7k9m",
    vibrate: true,
    sound: true,
  };

  // ── Init ──
  function init() {
    loadSettings();
    loadHistory();
    loadSeen();
    setupNavigation();
    setupEventDelegation();
    setupSettings();
    registerServiceWorker();
    connectNtfy();
  }

  // ── ntfy.sh Connection ──
  function connectNtfy() {
    Ntfy.connect({
      topic: settings.topic,
      replyTopic: settings.replyTopic,
      onMessage: handleMessage,
      onStatus: UI.setStatus,
    });
  }

  // ── Message Handler ──
  function handleMessage(notification) {
    // Deduplicate (from history fetch + live stream)
    if (seenIds.has(notification.id)) return;
    seenIds.add(notification.id);
    saveSeen();

    // Check if this was already answered (from stored history)
    const existing = notifications.find((n) => n.id === notification.id);
    if (existing) return;

    notifications.unshift(notification);

    // Haptic feedback for actionable notifications
    if (notification.type === "approve" || notification.type === "permission" || notification.type === "choice") {
      if (settings.vibrate && navigator.vibrate) {
        navigator.vibrate([200, 100, 200]);
      }
      if (settings.sound) {
        playBeep();
      }
    }

    renderDashboard();
    saveHistory();
  }

  // ── Rendering ──
  function renderDashboard() {
    const feed = document.getElementById("feed");
    const pending = document.getElementById("pending-area");

    // Separate pending actions vs regular notifications
    const pendingNotifs = notifications.filter(
      (n) => !n.answered && (n.type === "approve" || n.type === "permission" || n.type === "choice")
    );
    const regularNotifs = notifications.filter(
      (n) => n.answered || (n.type !== "approve" && n.type !== "permission" && n.type !== "choice")
    );

    // Render pending area
    pending.innerHTML = "";
    for (const n of pendingNotifs) {
      pending.appendChild(UI.createCard(n));
    }

    // Render feed
    feed.innerHTML = "";
    for (const n of regularNotifs) {
      feed.appendChild(UI.createCard(n));
    }

    UI.updateEmptyState("feed", "empty-state", notifications.length > 0);
  }

  function renderHistory() {
    const list = document.getElementById("history-list");
    list.innerHTML = "";
    for (const n of notifications) {
      const card = UI.createCard(n);
      // Override time display to show full date
      const timeEl = card.querySelector(".card-time");
      if (timeEl) timeEl.textContent = UI.fmtFullTime(n.time);
      list.appendChild(card);
    }
    UI.updateEmptyState("history-list", "history-empty", notifications.length > 0);
  }

  // ── Response Handling ──
  async function handleResponse(notifId, responseBody) {
    const notification = notifications.find((n) => n.id === notifId);
    if (!notification || notification.answered) return;

    const ok = await Ntfy.respond(responseBody);
    if (!ok) {
      // Retry once
      await new Promise((r) => setTimeout(r, 1000));
      await Ntfy.respond(responseBody);
    }

    notification.answered = true;
    notification.answeredWith = responseBody;
    saveHistory();
    renderDashboard();
  }

  // ── Event Delegation ──
  function setupEventDelegation() {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-response]");
      if (!btn) return;
      const notifId = btn.dataset.notifId;
      const response = btn.dataset.response;
      handleResponse(notifId, response);
    });
  }

  // ── Navigation ──
  function setupNavigation() {
    const navBtns = document.querySelectorAll(".nav-btn");
    navBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        // Update nav state
        navBtns.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        // Switch views
        document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
        document.getElementById("view-" + view).classList.add("active");
        // Refresh view content
        if (view === "history") renderHistory();
      });
    });
  }

  // ── Settings ──
  function setupSettings() {
    const btnSave = document.getElementById("btn-save-settings");
    const btnClear = document.getElementById("btn-clear-history");

    btnSave.addEventListener("click", () => {
      settings.topic = document.getElementById("setting-topic").value.trim();
      settings.replyTopic = document.getElementById("setting-reply").value.trim();
      settings.vibrate = document.getElementById("setting-vibrate").checked;
      settings.sound = document.getElementById("setting-sound").checked;
      saveSettings();
      // Reconnect with new settings
      Ntfy.disconnect();
      connectNtfy();
    });

    btnClear.addEventListener("click", () => {
      notifications = [];
      seenIds.clear();
      saveSeen();
      saveHistory();
      renderDashboard();
      renderHistory();
    });
  }

  function loadSettings() {
    try {
      const stored = localStorage.getItem(SETTINGS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        Object.assign(settings, parsed);
      }
    } catch { /* use defaults */ }

    // Populate form
    document.addEventListener("DOMContentLoaded", () => {
      document.getElementById("setting-topic").value = settings.topic;
      document.getElementById("setting-reply").value = settings.replyTopic;
      document.getElementById("setting-vibrate").checked = settings.vibrate;
      document.getElementById("setting-sound").checked = settings.sound;
    });
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // ── History Persistence ──
  function loadHistory() {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        notifications = parsed.map((n) => ({
          ...n,
          time: new Date(n.time),
        }));
        // Mark seen IDs from history
        for (const n of notifications) seenIds.add(n.id);
      }
    } catch { /* start fresh */ }
  }

  function saveHistory() {
    const toStore = notifications.slice(0, MAX_HISTORY);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(toStore));
  }

  function loadSeen() {
    try {
      const stored = localStorage.getItem(SEEN_KEY);
      if (stored) {
        const arr = JSON.parse(stored);
        for (const id of arr) seenIds.add(id);
      }
    } catch { /* ignore */ }
  }

  function saveSeen() {
    // Keep only last 200 IDs to prevent unbounded growth
    const arr = [...seenIds].slice(-200);
    localStorage.setItem(SEEN_KEY, JSON.stringify(arr));
  }

  // ── Sound ──
  function playBeep() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = "sine";
      gain.gain.value = 0.15;
      osc.start();
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.stop(ctx.currentTime + 0.3);
    } catch { /* no audio context */ }
  }

  // ── Service Worker ──
  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    }
  }

  // ── Start ──
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  return { handleResponse };
})();
