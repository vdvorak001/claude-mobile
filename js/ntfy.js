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

  const MAX_RECONNECT_DELAY = 30000;

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

  function connect(cfg) {
    topic = cfg.topic;
    replyTopic = cfg.replyTopic;
    onMessageCallback = cfg.onMessage;
    onStatusCallback = cfg.onStatus;
    intentionalClose = false;
    _connect();
  }

  function _connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    setStatus("reconnecting");

    // Fetch recent messages first (last 10 min)
    _fetchRecent().then(() => {
      ws = new WebSocket(`wss://ntfy.sh/${topic}/ws`);

      ws.onopen = () => {
        reconnectDelay = 1000;
        setStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          // Skip keepalive/open events
          if (msg.event && msg.event !== "message") return;
          _processMessage(msg);
        } catch { /* ignore parse errors */ }
      };

      ws.onclose = () => {
        if (!intentionalClose) {
          setStatus("disconnected");
          _scheduleReconnect();
        }
      };

      ws.onerror = () => {
        // onclose will fire after onerror
      };
    });
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

    if (onMessageCallback) onMessageCallback(notification);
  }

  async function _fetchRecent() {
    try {
      const since = Math.floor(Date.now() / 1000) - 600; // last 10 min
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
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (ws) ws.close();
    setStatus("disconnected");
  }

  return { connect, disconnect, respond, detectType, extractActions, extractReqId };
})();
