"use strict";

/**
 * ui.js — DOM rendering for notification cards, status, navigation.
 */
const UI = (() => {
  const TYPE_META = {
    done:       { icon: "\u2705", label: "Done",       cls: "card-done" },
    decision:   { icon: "\u26a0\ufe0f", label: "Decision",   cls: "card-decision" },
    approve:    { icon: "\ud83d\udd10", label: "Approve",    cls: "card-approve" },
    permission: { icon: "\ud83d\udd12", label: "Permission", cls: "card-permission" },
    choice:     { icon: "\ud83d\udc49", label: "Choice",     cls: "card-choice" },
  };

  /**
   * Format time as HH:MM.
   */
  function fmtTime(date) {
    return date.toLocaleTimeString("cs-CZ", { hour: "2-digit", minute: "2-digit" });
  }

  /**
   * Format time for history (includes date if not today).
   */
  function fmtFullTime(date) {
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return fmtTime(date);
    }
    return date.toLocaleDateString("cs-CZ", { day: "numeric", month: "short" }) + " " + fmtTime(date);
  }

  /**
   * Extract project name from title (pattern: "[PROJECT] ...").
   * Returns {project, cleanTitle}.
   */
  function parseProject(title) {
    const match = title.match(/^\[([^\]]+)\]\s*(.*)/);
    if (match) return { project: match[1], cleanTitle: match[2] };
    return { project: null, cleanTitle: title };
  }

  /**
   * Parse markdown-like bold (**text**) and newlines in message body.
   */
  function renderBody(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:var(--text)">$1</strong>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\\n/g, "\n");
  }

  /**
   * Build action buttons HTML for approve/permission cards.
   */
  function buildApproveActions(notification) {
    const actions = notification.actions || [];
    const okAction = actions.find((a) => a.body.startsWith("OK_"));
    const nokAction = actions.find((a) => a.body.startsWith("NOK_"));
    if (!okAction) return "";

    return `
      <div class="card-actions">
        <button class="btn btn-approve" data-response="${okAction.body}" data-notif-id="${notification.id}">
          OK
        </button>
        ${nokAction ? `<button class="btn btn-deny" data-response="${nokAction.body}" data-notif-id="${notification.id}">
          Deny
        </button>` : ""}
      </div>`;
  }

  /**
   * Build choice option buttons.
   * Parses options from message body (lines starting with **A: ...**).
   */
  function buildChoiceActions(notification) {
    const actions = notification.actions || [];
    if (!actions.length) return "";

    // Parse descriptions from message body
    const bodyLines = notification.message.split(/\\n|\n/).filter(Boolean);
    const descMap = {};
    for (const line of bodyLines) {
      const match = line.replace(/\*\*/g, "").match(/^([A-Z]):\s*(.+)/);
      if (match) descMap[match[1]] = match[2];
    }

    let html = '<div class="card-actions" style="flex-direction:column">';
    for (const action of actions) {
      const letter = action.label;
      const desc = descMap[letter] || "";
      html += `
        <button class="btn btn-choice" data-response="${action.body}" data-notif-id="${notification.id}">
          <span class="choice-letter">${letter}</span>
          ${desc ? `<span class="choice-desc">${renderBody(desc)}</span>` : ""}
        </button>`;
    }
    html += "</div>";
    return html;
  }

  /**
   * Create a notification card element.
   */
  function createCard(notification) {
    const meta = TYPE_META[notification.type] || TYPE_META.decision;
    const isPending = !notification.answered && (
      notification.type === "approve" ||
      notification.type === "permission" ||
      notification.type === "choice"
    );

    let actionsHtml = "";
    if (!notification.answered) {
      if (notification.type === "approve" || notification.type === "permission") {
        actionsHtml = buildApproveActions(notification);
      } else if (notification.type === "choice") {
        actionsHtml = buildChoiceActions(notification);
      }
    }

    const statusBadge = notification.answered
      ? `<span class="card-status-badge ${notification.answeredWith?.startsWith("OK") || /^[A-Z]_/.test(notification.answeredWith || "") ? "badge-approved" : "badge-denied"}">
          ${notification.answeredWith?.startsWith("OK") || /^[A-Z]_/.test(notification.answeredWith || "")
            ? "\u2705 Answered"
            : "\u274c Denied"}
         </span>`
      : "";

    const { project, cleanTitle } = parseProject(notification.title || "");

    const projectBadge = project
      ? `<span class="card-project">${project}</span>`
      : "";

    const el = document.createElement("div");
    el.className = `card ${meta.cls} ${isPending ? "card-pending" : ""} ${notification.answered ? "card-answered" : ""}`;
    el.dataset.id = notification.id;
    el.innerHTML = `
      <div class="card-header">
        <span class="card-type">
          <span class="card-type-icon">${meta.icon}</span>
          ${meta.label}
          ${projectBadge}
        </span>
        <span class="card-time">${fmtTime(notification.time)}</span>
      </div>
      ${cleanTitle ? `<div class="card-title">${cleanTitle}</div>` : ""}
      <div class="card-body">${renderBody(notification.message)}</div>
      ${actionsHtml}
      ${statusBadge}
    `;

    return el;
  }

  /**
   * Update connection status indicator.
   */
  function setStatus(status) {
    const dot = document.getElementById("status-dot");
    const text = document.getElementById("status-text");
    dot.className = "status-dot " + status;
    const labels = {
      connected: "Connected",
      disconnected: "Disconnected",
      reconnecting: "Reconnecting...",
    };
    text.textContent = labels[status] || status;
  }

  /**
   * Toggle empty state visibility.
   */
  function updateEmptyState(feedId, emptyId, hasItems) {
    const empty = document.getElementById(emptyId);
    if (empty) {
      empty.classList.toggle("hidden", hasItems);
    }
  }

  return { createCard, setStatus, updateEmptyState, fmtFullTime, renderBody };
})();
