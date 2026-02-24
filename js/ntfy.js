"use strict";

/**
 * ntfy.js — WebSocket connection to ntfy.sh
 * Handles subscribe, message routing, response publishing, auto-reconnect.
 */
const Ntfy = (() => {
  let ws = null;
  let topic = "";
  let replyTopic = "";
  let reconnectDelay = 1000;
  let reconnectTimer = null;
  let intentionalClose = false;
  let onMessageCallback = null;
  let onStatusCallback = null;
  let lastSince = null; // Unix timestamp of last received message (persisted)
  let watchdogTimer = null; // Force reconnect if no WS activity for WATCHDOG_MS

  const MAX_RECONNECT_DELAY = 10000; // Max 10s backoff (was 30s)
  const WATCHDOG_MS = 55000;         // ntfy.sh sends keepalive every ~45s
  const SINCE_KEY = "claude_mobile_since";

  function _loadLastSince() {
    try {
      const v = localStorage.getItem(SINCE_KEY);
      if (v) lastSince = parseInt(v, 10);
    } catch { /* ignore */ }
  }

  function _saveLastSince(ts) {
    if (!lastSince || ts > lastSince) {
      lastSince = ts;
      try { localStorage.setItem(SINCE_KEY, String(ts)); } catch { /* ignore */ }
    }
  }

  /**
   * Detect notification type from ntfy.sh message tags.
   * @param {object} msg — parsed ntfy.sh message
   * @returns {string} — done|decision|approve|permission|choice
   */
  function detectType(msg) {
    const tags = msg.tags || [];
    const title = msg.title || "";
    if (tags.includes("lock")) return "permission";
    if (tags.includes("point_right")) return "choice";
    if (tags.includes("question")) return "approve";
    if (tags.includes("white_check_mark")) return "done";
    if (tags.includes("warning")) return "decision";
    // Fallback: detect from title
    if (title.includes("Permission")) return "permission";
    if (title.includes("Vyber")) return "choice";
    if (title.includes("Schvaleni")) return "approve";
    if (title.includes("Hotovo")) return "done";
    return "decision";
  }

  /**
   * Extract action buttons from ntfy.sh message.
   * Returns array of {label, body} for response buttons.
   */
  function extractActions(msg) {
    if (!msg.actions || !Array.isArray(msg.actions)) return [];
    return msg.actions
      .filter((a) => a.action === "http")
      .map((a) => ({ label: a.label, body: a.body }));
  }

  /**
   * Extract REQ_ID from action body (pattern: "OK_1234567890").
   */
  function extractReqId(actions) {
    if (!actions.length) return null;
    const match = actions[0].body.match(/_(\d+)$/);
    return match ? match[1] : null;
  }

  function setStatus(status) {
    if (onStatusCallback) onStatusCallback(status);
  }

  /** Reset watchdog timer — call on every WS activity (open, message, keepalive). */
  function _resetWatchdog() {
    if (watchdogTimer) clearTimeout(watchdogTimer);
    watchdogTimer = setTimeout(() => {
      // No activity for WATCHDOG_MS — connection is stale, force reconnect
      if (ws) ws.close();
    }, WATCHDOG_MS);
  }

  function _clearWatchdog() {
    if (watchdogTimer) {
      clearTimeout(watchdogTimer);
      watchdogTimer = null;
    }
  }

  function _forceReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectDelay = 1000;
    _connect();
  }

  function connect(cfg) {
    topic = cfg.topic;
    replyTopic = cfg.replyTopic;
    onMessageCallback = cfg.onMessage;
    onStatusCallback = cfg.onStatus;
    intentionalClose = false;
    _loadLastSince();
    _connect();

    // Reconnect immediately when user returns to the app (tab/PWA visible again)
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && !intentionalClose) {
        if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
          _forceReconnect();
        }
      }
    });

    // Reconnect immediately when network comes back online
    window.addEventListener("online", () => {
      if (!intentionalClose) _forceReconnect();
    });
  }

  function _connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setStatus("reconnecting");

    // Open WebSocket immediately — no gap between history fetch and live stream.
    // Any message arriving during the fetch is caught by WS; deduplication handles overlaps.
    ws = new WebSocket(`wss://ntfy.sh/${topic}/ws`);

    ws.onopen = () => {
      reconnectDelay = 1000;
      setStatus("connected");
      _resetWatchdog();
    };

    ws.onmessage = (event) => {
      _resetWatchdog(); // any WS activity resets the stale-connection watchdog
      try {
        const msg = JSON.parse(event.data);
        // Skip keepalive/open events (but still reset watchdog above)
        if (msg.event && msg.event !== "message") return;
        _processMessage(msg);
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      _clearWatchdog();
      if (!intentionalClose) {
        setStatus("disconnected");
        _scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror
    };

    // Fetch missed messages in parallel (deduplication handles WS overlaps)
    _fetchRecent();
  }

  function _processMessage(msg) {
    const type = detectType(msg);
    const actions = extractActions(msg);
    const reqId = extractReqId(actions);

    const notification = {
      id: msg.id || String(Date.now()),
      type,
      title: msg.title || "",
      message: msg.message || "",
      time: msg.time ? new Date(msg.time * 1000) : new Date(),
      priority: msg.priority || 3,
      actions,
      reqId,
      answered: false,
      answeredWith: null,
    };

    if (msg.time) _saveLastSince(msg.time);
    if (onMessageCallback) onMessageCallback(notification);
  }

  async function _fetchRecent() {
    try {
      // Use persisted lastSince (minus 5s overlap) or fall back to 1 hour.
      // This covers cases where the app was backgrounded for more than 10 min.
      const fallback = Math.floor(Date.now() / 1000) - 3600;
      const since = lastSince ? Math.max(lastSince - 5, fallback) : fallback;
      const res = await fetch(
        `https://ntfy.sh/${topic}/json?poll=1&since=${since}`
      );
      if (!res.ok) return;
      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.event && msg.event !== "message") continue;
          _processMessage(msg);
        } catch { /* skip bad lines */ }
      }
    } catch { /* fetch failed, continue with WS */ }
  }

  function _scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      _connect();
    }, reconnectDelay);
  }

  /**
   * Send a response to the reply topic.
   * @param {string} body — e.g. "OK_1234567890"
   */
  async function respond(body) {
    try {
      await fetch(`https://ntfy.sh/${replyTopic}`, {
        method: "POST",
        body,
      });
      return true;
    } catch {
      return false;
    }
  }

  function disconnect() {
    intentionalClose = true;
    _clearWatchdog();
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
    setStatus("disconnected");
  }

  return { connect, disconnect, respond, detectType, extractActions, extractReqId };
})();
