import { createAnchorIcon, createNewConvoIcon, createMenuIcon } from './icons.js';
import { GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';
import { computeLayoutMD5 } from './md5.js';

/* Minimal on-screen debug tracer (overlay disabled) */
function debugTrace(label, data) {
  // Enable by setting window.__debugTrace = true from the console if needed
  if (!(typeof window !== 'undefined' && window.__debugTrace === true)) return;
  try { console.warn(label, data); } catch (_) {}
  return;
}

/* Snapshot current mode, persisted layout, and live grid nodes for diagnostics */
function __snapshotLayoutState() {
  let mode = 'docked';
  try { mode = getCurrentMode(); } catch (_) {}
  const persisted = (persistedSettings && persistedSettings[mode]) ? persistedSettings[mode] : null;
  const persistedLayout = (persisted && Array.isArray(persisted.layout)) ? persisted.layout : [];
  const md5 = (typeof computeLayoutMD5 === 'function') ? computeLayoutMD5(persistedLayout) : null;
  const nodes = (grid && grid.engine && Array.isArray(grid.engine.nodes))
    ? grid.engine.nodes.map(n => ({ widget: n?.el?.dataset?.widget || null, x: n.x, y: n.y, w: n.w, h: n.h }))
    : [];
  return {
    mode,
    float: !!floatEnabled,
    persisted: { md5, layout: persistedLayout },
    grid: { nodes }
  };
}

/* Convenience wrapper to log with a trigger/cause and include a snapshot */
function logWithSnapshot(trigger, details = {}) {
  try {
    const snap = __snapshotLayoutState();
    debugTrace(trigger, { ...details, snapshot: snap });
  } catch (_) {
    try { debugTrace(trigger, details); } catch (__){}
  }
}
 
/*
 ==============================================================================
 File: src/index.js

 Organization (no logic change):
 - State and constants
 - Sessions and Sidebar
 - Canonical History and Rendering
 - Text Chat
 - Toasts
 - Grid/Layout and Settings
 - Bootstrap and DOMContentLoaded (last)

 Notes:
 - Function declarations are used to preserve hoisting.
 - FileMaker callbacks are stubbed in index.html before module load.
 ==============================================================================
*/

let grid = null;
let toastsWidgetEl = null;
let textWidgetEl = null;
let convosWidgetEl = null;
let isConvosDocked = true;
let floatEnabled = true;

/* Persisted per-mode settings cached in the web app */
let persistedSettings = { docked: null, undocked: null };

/* In-memory chat buffer to retain messages while Text widget is hidden */
const chatBuffer = [];
const HISTORY_MAX_ITEMS = 400;
const sessionHistory = [];
let showToolPills = false;
let prefsReady = false;
let applyingFromFM = false;
let mutatingLayout = false;
let settingsSaveTimer = null;
let layoutSaveTimer = null;
function scheduleSaveSettings(delay = 400) {
  if (settingsSaveTimer) { try { clearTimeout(settingsSaveTimer); } catch (_) {} }
  settingsSaveTimer = setTimeout(() => { try { saveSession({ settings: true }); } catch (_) {} }, Math.max(0, delay));
}
function scheduleSaveLayout(delay = 400) {
  if (layoutSaveTimer) { try { clearTimeout(layoutSaveTimer); } catch (_) {} }
  layoutSaveTimer = setTimeout(() => { try { saveSession({ layout: true }); } catch (_) {} }, Math.max(0, delay));
}

/* ================================ */
/* Sessions and Sidebar             */
/* ================================ */
/* Sessions list (for sidebar and undocked Conversations widget) */
window.__sessions = window.__sessions || []; // [{id, title}]
/* Track recently deleted sessions to filter them from stale FileMaker responses */
const __recentlyDeletedSessions = new Set();

function setSessionList(list) {
  if (!Array.isArray(list)) {
    try { showToast('Invalid sessions list: expected an array', 'tool-error', 'left', null, 6); } catch (_) {}
    return;
  }
  let warned = false;
  // Filter out any recently deleted sessions to prevent stale FM data from restoring them
  const filtered = list.filter(it => {
    const sid = (it && typeof it.sessionId === 'string') ? it.sessionId
      : (it && typeof it.id === 'string') ? it.id
      : '';
    return !__recentlyDeletedSessions.has(sid);
  });
  window.__sessions = filtered.map(it => {
    const sid = (it && typeof it.sessionId === 'string') ? it.sessionId
      : (it && typeof it.id === 'string') ? it.id
      : '';
    const title = (it && typeof it.title === 'string') ? it.title
      : (it && typeof it.name === 'string') ? it.name
      : (sid || '');
    if ((!it || typeof it.sessionId !== 'string' || typeof it.title !== 'string') && !warned) {
      warned = true;
      try { showToast('Sessions should use {sessionId, title}. Falling back on legacy keys.', 'tool-error', 'left', null, 6); } catch (_) {}
    }
    return { id: String(sid), title: String(title) };
  }).filter(it => it.id);
  renderSessionList();
}

function applySessionTitle(payload) {
  const p = typeof payload === 'string' ? parseJsonSafely(payload, 'applySessionTitle') : (payload || {});
  const sid = (p && typeof p.sessionId === 'string') ? p.sessionId : '';
  const title = (p && typeof p.title === 'string') ? p.title : '';
  if (!sid || !title) return false;

  // Update in-memory sessions list
  if (Array.isArray(window.__sessions)) {
    let changed = false;
    window.__sessions = window.__sessions.map(s => {
      if (s && s.id === sid && s.title !== title) {
        changed = true;
        return { ...s, title };
      }
      return s;
    });
    if (changed) {
      renderSessionList();
      // If current session matches, update any other UI elements that show the title here if needed.
    }
  }
  return true;
}

function getAssistantTurnCount() {
  try {
    let count = 0;
    for (const it of sessionHistory) {
      if (
        it &&
        it.type === 'message' &&
        it.role === 'assistant' &&
        typeof it.content === 'string' &&
        it.content.trim() !== ''
      ) {
        count++;
      }
    }
    return count;
  } catch (_) { return 0; }
}

function getCurrentSessionTitle() {
  try {
    const sid = window.__sessionId || '';
    if (!sid || !Array.isArray(window.__sessions)) return '';
    const it = window.__sessions.find(s => s && s.id === sid);
    return (it && typeof it.title === 'string') ? it.title : '';
  } catch (_) { return ''; }
}

function isDefaultSessionTitle(title) {
  try {
    return (String(title || '').trim().toLowerCase() === 'new session');
  } catch (_) { return false; }
}

/**
 * Trigger an automatic session title request to FileMaker exactly once per session,
 * only after the threshold of assistant turns, and only when the current title
 * is still the default placeholder ("New Session").
 * FileMaker should compute the title and call window.applySessionTitle({ sessionId, title }).
 */
function maybeTriggerAutoSessionTitle(reason = 'auto') {
  try {
    const sid = window.__sessionId || '';
    if (!sid) return false;

    // Ensure one-time per session (in this viewer runtime)
    if (!window.__autoNameTriggeredSessions) window.__autoNameTriggeredSessions = {};
    if (window.__autoNameTriggeredSessions[sid]) return false;

    // Only auto-name if current title is the default placeholder
    const currentTitle = getCurrentSessionTitle();
    if (!isDefaultSessionTitle(currentTitle)) return false;

    // Default threshold: after first assistant reply
    const threshold = (typeof window.__autoNameAfterTurns === 'number' && window.__autoNameAfterTurns >= 1)
      ? window.__autoNameAfterTurns
      : 1;

    const count = getAssistantTurnCount();
    if (count < threshold) return false;

    // Mark as triggered for this session id
    window.__autoNameTriggeredSessions[sid] = true;

    // Ask FileMaker to compute a title; FM should call back window.applySessionTitle
    callFM(FM_SCRIPTS.RenameSession, {
      sessionId: sid,
      auto: true,
      reason,
      turnCount: count,
      onlyIfUntitled: true,
      notify: 'title'
    });
    return true;
  } catch (_) {
    return false;
  }
}

function highlightActiveSession(sessionId) {
  const all = document.querySelectorAll('.conversation-item');
  all.forEach(el => {
    const sid = el.getAttribute('data-session-id');
    el.classList.toggle('active', !!sessionId && sid === sessionId);
  });
}

function beginRenameSessionInline(rowEl, sessionId, currentTitle) {
  if (!rowEl || !sessionId || rowEl.classList.contains('editing')) return;
  rowEl.classList.add('editing');

  const titleSpan = rowEl.querySelector('span');
  const delBtn = rowEl.querySelector('.session-delete-btn');
  if (delBtn) delBtn.style.display = 'none';

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'session-rename-input';
  input.value = currentTitle || '';
  input.style.width = 'calc(100% - 24px)';
  input.style.border = '1px solid rgba(255,255,255,0.3)';
  input.style.background = 'transparent';
  input.style.color = 'inherit';
  input.style.padding = '2px 6px';
  input.style.borderRadius = '4px';

  if (titleSpan) {
    titleSpan.replaceWith(input);
  } else {
    rowEl.insertBefore(input, delBtn || null);
  }

  input.focus();
  try { input.select(); } catch (_) {}

  const original = currentTitle || '';

  function finish(commit) {
    rowEl.classList.remove('editing');
    if (!commit) {
      renderSessionList();
      return;
    }
    const newTitle = (input.value || '').trim();
    if (!newTitle || newTitle === original) {
      renderSessionList();
      return;
    }
    window.__sessions = (window.__sessions || []).map(s =>
      s && s.id === sessionId ? { ...s, title: newTitle } : s
    );
    renderSessionList();
    callFM(FM_SCRIPTS.RenameSession, { sessionId, title: newTitle });
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

function renderSessionList() {
  const containers = document.querySelectorAll('.conversation-list');
  if (!containers || containers.length === 0) return;

  containers.forEach(container => {
    container.innerHTML = '';
    for (const s of (window.__sessions || [])) {
      const row = document.createElement('div');
      row.className = 'conversation-item';
      row.setAttribute('data-session-id', s.id);
      row.style.position = 'relative';

      // Title text
      const titleEl = document.createElement('span');
      titleEl.textContent = s.title || s.id;
      row.appendChild(titleEl);
      titleEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        beginRenameSessionInline(row, s.id, titleEl.textContent || s.title || s.id);
      });

      // Delete "×" button (shows on hover)
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'session-delete-btn';
      delBtn.setAttribute('aria-label', 'Delete conversation');
      delBtn.title = 'Delete this conversation';
      delBtn.textContent = '×';
      delBtn.style.position = 'absolute';
      delBtn.style.right = '6px';
      delBtn.style.top = '50%';
      delBtn.style.transform = 'translateY(-50%)';
      delBtn.style.display = 'none';
      delBtn.style.border = 'none';
      delBtn.style.background = 'transparent';
      delBtn.style.color = 'inherit';
      delBtn.style.cursor = 'pointer';
      delBtn.style.fontSize = '16px';
      delBtn.style.lineHeight = '1';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteSessionConfirm(s.id);
      });

      row.addEventListener('mouseenter', () => { delBtn.style.display = 'block'; });
      row.addEventListener('mouseleave', () => { delBtn.style.display = 'none'; });
      row.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        beginRenameSessionInline(row, s.id, titleEl.textContent || s.title || s.id);
      });

      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (row.classList.contains('editing')) return;
        switchSession(s.id);
      });

      row.appendChild(delBtn);
      container.appendChild(row);
    }
  });

  highlightActiveSession(window.__sessionId || '');
}

// Choose the next session to select after deleting one.
// Assumes window.__sessions is ordered by most-recent first.
function pickNextSessionAfter(deletedId, prevList) {
  const remaining = (prevList || []).filter(s => s && s.id !== deletedId);
  if (remaining.length === 0) return null;
  return remaining[0];
}

// Confirm and delete a session with optimistic UI update.
async function deleteSessionConfirm(sessionId) {
  if (!sessionId) return false;

  // Find the session title to show in confirmation
  const session = (window.__sessions || []).find(s => s && s.id === sessionId);
  const sessionTitle = session ? (session.title || sessionId) : sessionId;

  const ok = await showConfirmModal(
    `Permanently delete "${sessionTitle}"? This cannot be undone.`,
    { title: 'Delete conversation', confirmText: 'Delete', cancelText: 'Cancel', danger: true }
  );
  if (!ok) return false;

  const prev = Array.isArray(window.__sessions) ? window.__sessions.slice() : [];
  const wasCurrent = (window.__sessionId === sessionId);

  // Optimistically remove from list and re-render
  window.__sessions = prev.filter(s => s && s.id !== sessionId);

  // Track this deletion to filter stale FileMaker responses for a few seconds
  __recentlyDeletedSessions.add(sessionId);
  setTimeout(() => __recentlyDeletedSessions.delete(sessionId), 5000);

  renderSessionList();

  // If we just deleted the active session, select the next most recent or start a new one
  if (wasCurrent) {
    const next = pickNextSessionAfter(sessionId, prev);
    if (next && next.id) {
      // Avoid flushing deleted session; do not call switchSession here
      window.__sessionId = next.id;
      highlightActiveSession(next.id);
      try {
        const list = document.getElementById('chat-messages');
        if (list) list.innerHTML = '';
      } catch (_) {}
      requestSessionState(next.id);
    } else {
      // No sessions remain; start a new one without flushing the deleted session
      window.__sessionId = '';
      callFM(FM_SCRIPTS.NewSession, {});
    }
  }

  // Notify FileMaker to delete the session record
  callFM(FM_SCRIPTS.DeleteSession, { sessionId });

  return true;
}

/* Request full session bundle from FileMaker */
function requestSessionState(sessionId) {
  return callFM(FM_SCRIPTS.GetState, { sessionId });
}

/* Switch current session: flush current, then request next */
function switchSession(newSessionId) {
  const current = window.__sessionId || '';
  if (!newSessionId || newSessionId === current) return false;

  logWithSnapshot('[ui] switchSession:pre', { from: current, to: String(newSessionId) });
  try { saveSession({ history: true }); } catch (_) {}
  window.__sessionId = newSessionId;
  highlightActiveSession(newSessionId);
  // Clear UI chat view immediately (optional)
  try {
    const list = document.getElementById('chat-messages');
    if (list) list.innerHTML = '';
  } catch (_) {}
  requestSessionState(newSessionId);
  logWithSnapshot('[ui] switchSession:post', { to: String(newSessionId) });
  return true;
}

function startNewSession(title = null) {
  try { saveSession({ history: true, settings: true }); } catch (_) {}
  const payload = {};
  if (title && typeof title === 'string') payload.title = title;
  if (window.__sessionId) payload.previousSessionId = window.__sessionId;
  callFM(FM_SCRIPTS.NewSession, payload);
}

/* FM callback to apply a session bundle returned by Session_GetState */
function applySessionState(payload) {
  try {
    // History-only fast path: if payload only carries { sessionId?, history[] }
    const raw = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
    const data = (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'success'))
      ? (raw.success ? (raw.result || {}) : null)
      : raw;
    try {
      debugTrace('[applySessionState] received', {
        typeofPayload: typeof payload,
        envelopeKeys: raw && typeof raw === 'object' ? Object.keys(raw) : null,
        dataKeys: data && typeof data === 'object' ? Object.keys(data) : null,
        hasHistory: !!(data && Array.isArray(data.history)),
        hasLayout: !!(data && data.layout),
        hasSettings: !!(data && data.settings)
      });
    } catch (_) {}

    if (data && Array.isArray(data.history) && !data.layout && !data.settings) {
      if (typeof data.sessionId === 'string' && data.sessionId) {
        window.__sessionId = data.sessionId;
      }

      // Normalize incoming items into canonical sessionHistory and buffered text view
      const incoming = [];
      const bufferMsgs = [];

      for (const m of data.history) {
        const ts =
          (m && m.ts !== undefined) ? m.ts
          : (m && m.timestamp !== undefined) ? m.timestamp
          : (m && m.time !== undefined) ? m.time
          : Date.now();

        if (m && m.type === 'tool_call') {
          incoming.push({
            id: (m && m.id != null && String(m.id).trim() !== '') ? String(m.id) : createId('tc'),
            ts,
            role: 'tool',
            type: 'tool_call',
            content: (typeof m?.content === 'string' ? m.content : null),
            metadata: {
              responseId: m.responseId || null,
              call_id: m.call_id || m.id || null,
              tool: {
                name: m.name || m?.tool?.name || 'unknown',
                arguments: (m?.args ?? m?.arguments ?? m?.tool?.arguments) ?? null
              }
            }
          });
          continue;
        }

        if (m && m.type === 'tool_result') {
          incoming.push({
            id: (m && m.id != null && String(m.id).trim() !== '') ? String(m.id) : createId('tr'),
            ts,
            role: 'tool',
            type: 'tool_result',
            content: (m.output ?? m.content) ?? null,
            metadata: {
              call_id: m.call_id || null,
              status: m.status || null
            }
          });
          continue;
        }

        // Message-like
        const role = m?.role || 'system';
        const text = typeof m?.content === 'string'
          ? m.content
          : (typeof m?.text === 'string' ? m.text : '');

        const item = {
          id: (m && m.id != null && String(m.id).trim() !== '') ? String(m.id) : createId('m'),
          ts,
          role,
          type: 'message',
          content: text,
          metadata: { api: m?.metadata?.api ?? m?.metadata?.source ?? m?.source ?? null }
        };
        incoming.push(item);

        if (text) {
          bufferMsgs.push({
            role,
            text,
            ts,
            source: item.metadata?.api || null
          });
        }
      }

      sessionHistory.splice(0, sessionHistory.length, ...incoming);
      trimHistory();
      // Rebuild the lightweight text buffer used by the Text widget
      chatBuffer.splice(0, chatBuffer.length, ...bufferMsgs);
      try {
        debugTrace('[applySessionState] fast-path:applied', {
          incoming: incoming.length,
          bufferMsgs: bufferMsgs.length,
          sessionId: window.__sessionId || '',
          historyLen: sessionHistory.length
        });
      } catch (_) {}

      renderChatFromHistory();
      const auto = maybeTriggerAutoSessionTitle('text_turn_end');
      highlightActiveSession(window.__sessionId || '');
      try { debugTrace('[applySessionState] fast-path:done', { autoTitleTriggered: !!auto }); } catch (_) {}
      return true;
    }

    // Fallback: full bootstrap for envelopes that include settings/layout/other keys
    try { debugTrace('[applySessionState] fallback->bootstrap', { hasData: !!data }); } catch (_) {}
    const ok = bootstrapApp(payload);
    highlightActiveSession(window.__sessionId || '');
    try { debugTrace('[applySessionState] fallback:done', { ok: !!ok, sid: window.__sessionId || '' }); } catch (_) {}
    return !!ok;
  } catch (e) {
    console.error('applySessionState failed', e);
    try { debugTrace('[applySessionState] error', { message: e?.message || String(e), stack: e?.stack || null }); } catch (_){}
    return false;
  }
}

/* Agents are fully managed by FileMaker (no agent state in JS) */

function createId(prefix = 'msg') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimHistory() {
  if (sessionHistory.length > HISTORY_MAX_ITEMS) {
    sessionHistory.splice(0, sessionHistory.length - HISTORY_MAX_ITEMS);
  }
}

function appendCanonicalMessage(role, text, metadata = {}) {
  if (!text) return null;
  
  // Normalize metadata to always use 'api' field
  const normalizedMetadata = {
    api: metadata.api || metadata.source || null
  };
  
  const item = {
    id: createId('m'),
    ts: Date.now(),
    role,
    type: 'message',
    content: text,
    metadata: normalizedMetadata
  };
  sessionHistory.push(item);
  // Ensure Conversations widget appears when undocked only if a saved rect exists
  if (!isConvosDocked && !convosWidgetEl) {
    const saved = getSavedWidgetRect('convo', getCurrentMode());
    if (saved) { window.__addConversationsWidget && window.__addConversationsWidget(saved); }
  }
  trimHistory();
  return item;
}

function appendToolCall(name, args, call_id, responseId, summary = null) {
  sessionHistory.push({
    id: createId('tc'),
    ts: Date.now(),
    role: 'tool',
    type: 'tool_call',
    content: (typeof summary === 'string' && summary.trim() !== '' ? summary.trim() : null),
    metadata: {
      responseId: responseId || null,
      call_id: call_id || null,
      tool: { name: name || 'unknown', arguments: args ?? null }
    }
  });
  trimHistory();
}

function appendToolResult(call_id, output, status = 'success', error = null) {
  // Derive the tool name from the most recent matching tool_call (by call_id)
  let toolName = null;
  try {
    for (let i = sessionHistory.length - 1; i >= 0; i--) {
      const it = sessionHistory[i];
      if (it && it.type === 'tool_call' && (it.metadata?.call_id === call_id || it.metadata?.call_id === (call_id || null))) {
        toolName = it.metadata?.tool?.name || null;
        break;
      }
    }
  } catch (_) {}

  sessionHistory.push({
    id: createId('tr'),
    ts: Date.now(),
    role: 'tool',
    type: 'tool_result',
    content: output ?? null,
    metadata: {
      call_id: call_id || null,
      status,
      error,
      tool: toolName ? { name: toolName } : undefined
    }
  });
  trimHistory();
}

function renderToolPill(label, data, id = null) {
  const row = document.createElement('div');
  row.className = 'tool-pill-row';
  row.style.position = 'relative';

  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'tool-pill';
  pill.textContent = label;
  pill.style.position = 'relative';
  pill.addEventListener('click', () => {
    if (window.FileMaker) {
      try { if (callFM(FM_SCRIPTS.ShowJSON, data)) return; } catch (_) {}
    }
    showJsonModal(data);
  });

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'msg-close';
  closeBtn.textContent = '×';
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '-8px';
  closeBtn.style.right = '-6px';
  closeBtn.style.display = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.background = 'transparent';
  closeBtn.style.color = 'inherit';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = '18px';
  closeBtn.style.zIndex = '2';
  closeBtn.setAttribute('aria-label', 'Delete item');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (id) {
      deleteHistoryItem(id);
    }
  });

  pill.addEventListener('mouseenter', () => { closeBtn.style.display = 'block'; });
  pill.addEventListener('mouseleave', () => { closeBtn.style.display = 'none'; });

  row.appendChild(pill);
  pill.appendChild(closeBtn);

  const list = document.getElementById('chat-messages');
  if (list) {
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
  }
}

function renderChatFromHistory() {
  const list = document.getElementById('chat-messages');
  if (!list) return;
  list.innerHTML = '';

  const lastIdx = sessionHistory.length - 1;

  for (let i = 0; i < sessionHistory.length; i++) {
    const item = sessionHistory[i];
    if (!item) continue;

    if (item.type === 'message') {
      renderChatMessage(item.role, item.content, item.id);
      continue;
    }

    if (item.type === 'tool_call' || item.type === 'tool_result') {
      if (showToolPills) {
        const name = item?.metadata?.tool?.name || 'unknown';
        let label;
        if (item.type === 'tool_call') {
          const c = (typeof item.content === 'string' ? item.content : '').trim();
          label = c ? `Tool call: ${name} — ${safeStr(c, 140)}` : `Tool call: ${name}`;
        } else {
          label = `Tool result: ${name}`.trim();
        }
        renderToolPill(label, item, item.id);
      } else {
        // Pills OFF: only show a pill if it is the final item in history.
        // This ensures no pills appear between any chat messages.
        if (i === lastIdx) {
          const name = item?.metadata?.tool?.name || 'unknown';
          let label;
          if (item.type === 'tool_call') {
            const c = (typeof item.content === 'string' ? item.content : '').trim();
            label = c ? `Tool call: ${name} — ${safeStr(c, 140)}` : `Tool call: ${name}`;
          } else {
            label = `Tool result: ${name}`.trim();
          }
          renderToolPill(label, item, item.id);
        }
      }
    }
  }
}

function deleteHistoryItem(id) {
  const idx = sessionHistory.findIndex(it => it && it.id === id);
  if (idx >= 0) {
    sessionHistory.splice(idx, 1);
    rebuildChatBufferFromSession();
    renderChatFromHistory();
    try { saveSession({ history: true }); } catch (_) {}
    return true;
  }
  return false;
}

function rebuildChatBufferFromSession() {
  try {
    const msgs = sessionHistory
      .filter(it => it && it.type === 'message')
      .map(it => ({
        role: it.role,
        text: it.content || '',
        ts: it.ts,
        source: it.metadata?.api || null
      }));
    chatBuffer.splice(0, chatBuffer.length, ...msgs);
  } catch (_) {}
}

function showJsonModal(data) {
  const existing = document.querySelector('.json-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.className = 'json-modal';
  modal.innerHTML = `
    <div class="json-modal-content">
      <div class="json-modal-header">
        <div class="json-modal-title">Details</div>
        <button class="json-modal-close" aria-label="Close">×</button>
      </div>
      <pre class="json-content"></pre>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.json-content').textContent = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  modal.querySelector('.json-modal-close').addEventListener('click', hideJsonModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) hideJsonModal(); });
}

function hideJsonModal() {
  const modal = document.querySelector('.json-modal');
  if (modal) modal.remove();
}

/**
 * Generic confirm modal (Promise-based).
 * Reuses the json-modal styles already present in the app.
 * Returns a Promise<boolean> that resolves true on confirm, false on cancel/close.
 */
function showConfirmModal(message, options = {}) {
  const opts = {
    title: options.title || 'Confirm',
    confirmText: options.confirmText || 'OK',
    cancelText: options.cancelText || 'Cancel',
    danger: !!options.danger
  };

  // Remove any existing modal first
  const existing = document.querySelector('.json-modal');
  if (existing) existing.remove();

  return new Promise((resolve) => {
    const modal = document.createElement('div');
    modal.className = 'json-modal';
    modal.innerHTML = `
      <div class="json-modal-content">
        <div class="json-modal-header">
          <div class="json-modal-title">${opts.title}</div>
          <button class="json-modal-close" aria-label="Close">×</button>
        </div>
        <div class="json-confirm-message" style="padding: 8px 12px;">
          ${message}
        </div>
        <div class="json-modal-actions" style="display:flex; gap:8px; justify-content:flex-end; padding: 0 12px 12px;">
          <button class="json-confirm-cancel">${opts.cancelText}</button>
          <button class="json-confirm-ok${opts.danger ? ' danger' : ''}">${opts.confirmText}</button>
        </div>
      </div>`;

    document.body.appendChild(modal);

    const btnClose = modal.querySelector('.json-modal-close');
    const btnCancel = modal.querySelector('.json-confirm-cancel');
    const btnOk = modal.querySelector('.json-confirm-ok');

    function cleanup(result) {
      try { modal.remove(); } catch (_) {}
      resolve(result);
    }

    btnClose?.addEventListener('click', () => cleanup(false));
    btnCancel?.addEventListener('click', () => cleanup(false));
    btnOk?.addEventListener('click', () => cleanup(true));

    modal.addEventListener('click', (e) => {
      if (e.target === modal) cleanup(false);
    });

    function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        cleanup(false);
      } else if (e.key === 'Enter') {
        document.removeEventListener('keydown', onKey);
        cleanup(true);
      }
    }
    document.addEventListener('keydown', onKey);

    try { btnOk?.focus(); } catch (_) {}
  });
}

function getCurrentMode() {
  return isConvosDocked ? 'docked' : 'undocked';
}

function loadPersistedSettings() {
  try {
    const rawDocked = localStorage.getItem('settings:docked');
    const rawUndocked = localStorage.getItem('settings:undocked');
    if (rawDocked) {
      const env = JSON.parse(rawDocked);
      if (env && env.settings && Array.isArray(env.settings.layout) && !persistedSettings.docked) {
        persistedSettings.docked = env.settings;
      }
    }
    if (rawUndocked) {
      const env = JSON.parse(rawUndocked);
      if (env && env.settings && Array.isArray(env.settings.layout) && !persistedSettings.undocked) {
        persistedSettings.undocked = env.settings;
      }
    }
  } catch (e) {
    console.warn('Failed to load persisted settings from localStorage', e);
  }
}

/* Helpers to cache/restore individual widget positions per-mode */
function ensureModeSettings(mode = getCurrentMode()) {
  if (!persistedSettings[mode]) {
    const snapshot = computeCurrentSettingsSnapshot();
    persistedSettings[mode] = snapshot || {
      version: 1,
      columns: grid?.engine?.column || grid?.opts?.column || 12,
      cellHeight: undefined,
      float: !!floatEnabled,
      text: !!textWidgetEl,
      toasts: !!toastsWidgetEl,
      showToolCalls: !!showToolPills,
      layout: []
    };
  }
  if (!Array.isArray(persistedSettings[mode].layout)) {
    persistedSettings[mode].layout = [];
  }
  return persistedSettings[mode];
}

function persistModeSettings(mode = getCurrentMode()) {
  try {
    localStorage.setItem(`settings:${mode}`, JSON.stringify({ key: mode, settings: persistedSettings[mode] }));
  } catch (_) {}
}

function getSavedWidgetRect(widget, mode = getCurrentMode()) {
  const s = persistedSettings[mode];
  if (!s || !Array.isArray(s.layout)) return null;
  const entry = s.layout.find(n => n && n.widget === widget);
  if (entry && typeof entry.x === 'number') {
    return { x: entry.x, y: entry.y, w: entry.w, h: entry.h };
  }
  return null;
}

function updateSavedWidgetRect(widget, rect, mode = getCurrentMode()) {
  if (!rect || typeof rect !== 'object') return;
  const s = ensureModeSettings(mode);
  const layout = s.layout;
  const idx = layout.findIndex(n => n && n.widget === widget);
  const normalized = {
    widget,
    x: Number(rect.x ?? 0),
    y: Number(rect.y ?? 0),
    w: Number(rect.w ?? 4),
    h: Number(rect.h ?? 4)
  };
  if (idx >= 0) {
    layout[idx] = normalized;
  } else {
    layout.push(normalized);
  }
  persistModeSettings(mode);
}

/* Widget add dispatcher used by layout rebuilders (Step 4) */
function addWidgetByType(type, rect, flags) {
  const adders = {
    toasts: (r) => flags.includeToasts && window.__addToastsWidget && window.__addToastsWidget(r),
    text: (r) => flags.includeText && window.__addTextWidget && window.__addTextWidget(r),
    convo: (r) => (!isConvosDocked) && window.__addConversationsWidget && window.__addConversationsWidget(r)
  };
  const fn = adders[type];
  if (fn) fn(rect);
}

/* Default widget positions removed: layouts must come from session/user defaults */

/* Rebuild grid from a layout array (+ float), respecting current dock state for convo */
function rebuildFromLayout(layout = [], float = floatEnabled, options = {}) {
  if (!grid) return;
  mutatingLayout = true;
  try {
    try {
      debugTrace('[rebuildFromLayout] start', { mode: getCurrentMode(), md5: (Array.isArray(layout) ? computeLayoutMD5(layout) : 'n/a'), layout });
    } catch (_) {}

  const desiredFloat = (typeof float === 'boolean') ? !!float : !!floatEnabled;
  if (typeof grid.float === 'function') {
    // Prevent intermediate repack while removing/adding nodes
    grid.float(false);
  }

  const includeText = options.includeText !== undefined ? !!options.includeText : true;
  const includeToasts = options.includeToasts !== undefined ? !!options.includeToasts : true;

  // Remove all existing widgets (batched to prevent reflow/pack during teardown)
  const existing = [...(grid.engine?.nodes || [])];
  grid.batchUpdate();
  existing.forEach(n => n?.el && grid.removeWidget(n.el));
  toastsWidgetEl = null;
  textWidgetEl = null;
  convosWidgetEl = null;

  // Add widgets back based on layout (respect toggles) via dispatcher
  const flags = { includeText, includeToasts };
  const nodesToAdd = Array.isArray(layout) ? [...layout] : [];
  nodesToAdd.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const desiredNodes = nodesToAdd.map(n => ({
    widget: String(n.widget),
    x: Number(n.x), y: Number(n.y), w: Number(n.w), h: Number(n.h)
  }));
  desiredNodes.forEach(n => {
    addWidgetByType(n.widget, { x: n.x, y: n.y, w: n.w, h: n.h, autoPosition: false }, flags);
  });
  grid.commit();
  if (typeof grid.float === 'function') {
    floatEnabled = desiredFloat;
    grid.float(desiredFloat);
  }
  // Enforce final positions post-commit and log actual vs desired for diagnostics
  try {
    const actual = (grid.engine?.nodes || []).map(n => ({
      widget: n?.el?.dataset?.widget || null, x: n.x, y: n.y, w: n.w, h: n.h
    }));
    const elByType = {
      toasts: toastsWidgetEl,
      text: textWidgetEl,
      convo: convosWidgetEl
    };
    desiredNodes.forEach(n => {
      const el = elByType[n.widget];
      if (el && el.gridstackNode && (el.gridstackNode.x !== n.x || el.gridstackNode.y !== n.y || el.gridstackNode.w !== n.w || el.gridstackNode.h !== n.h)) {
        grid.update(el, { x: n.x, y: n.y, w: n.w, h: n.h });
      }
    });
    const actualAfter = (grid.engine?.nodes || []).map(n => ({
      widget: n?.el?.dataset?.widget || null, x: n.x, y: n.y, w: n.w, h: n.h
    }));
    const diff = { desired: desiredNodes, actualBefore: actual, actualAfter };
    window.__lastLayoutDiff = diff;
    debugTrace('[layout:rebuild] enforced positions', { mode: getCurrentMode(), float: desiredFloat, diff });
  } catch (e) {
    console.warn('[layout:rebuild] enforcement failed', e);
  }
  } finally {
    mutatingLayout = false;
    if (prefsReady && !applyingFromFM) scheduleSaveLayout(250);
  }
}

/* Apply settings for a given mode (docked/undocked): set toggles, float, and rebuild layout */
function applySettingsForMode(mode) {
  const settings = persistedSettings[mode];
  if (!settings || !Array.isArray(settings.layout)) return false;


  // Apply grid sizing options before rebuilding
  if (typeof settings.columns === 'number' && grid && typeof grid.column === 'function') {
    grid.column(settings.columns);
  }
  if (typeof settings.cellHeight === 'number' && grid && typeof grid.cellHeight === 'function') {
    grid.cellHeight(settings.cellHeight);
  }

  // Update menu button states
  const btnText = document.getElementById('btn-text');
  const btnToasts = document.getElementById('btn-toasts');
  const btnToolCalls = document.getElementById('btn-tool-calls');
  if (btnText) {
    setPressed(btnText, !!settings.text);
  }
  if (btnToasts) {
    setPressed(btnToasts, !!settings.toasts);
  }
  if (btnToolCalls) {
    const on = (typeof settings.showToolCalls === 'boolean') ? !!settings.showToolCalls : !!showToolPills;
    setPressed(btnToolCalls, on);
    showToolPills = on;
    renderChatFromHistory();
  }

  try { debugTrace('[applySettingsForMode] using', { mode, md5: computeLayoutMD5(settings.layout), float: settings.float, layout: settings.layout }); } catch (_) {}

  rebuildFromLayout(settings.layout, settings.float, {
    includeText: !!settings.text,
    includeToasts: !!settings.toasts
  });
  return true;
}


/*
 * Expose functions to FileMaker
 */
window.showToast = showToast;
window.setUISettings = setUISettings;
window.getChatHistoryText = chatHistoryToText;
window.logChatHistory = logChatHistory;
window.getChatBuffer = getChatBuffer;
window.logChatBufferRaw = logChatBufferRaw;
window.bootstrapApp = bootstrapApp;
window.copyMinifiedHistory = copyMinifiedHistory;
window.buildBootstrapTestPayload = buildBootstrapTestPayload;
window.applyLoadedLayout = applyLoadedLayout;
window.applySettingsEnvelope = applySettingsEnvelope;
window.savePreferences = savePreferences;
window.saveSession = saveSession;
window.saveSessionState = saveSessionState;
window.getSessionState = getSessionState;
window.switchSession = switchSession;
window.startNewSession = startNewSession;
window.applySessionState = applySessionState;
window.requestSessionState = requestSessionState;
window.setSessionList = setSessionList;
window.applySessionTitle = applySessionTitle;

function parseJsonSafely(value, label) {
  if (!value) {
    return null;
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.error(`Failed to parse JSON for ${label}:`, error);
    return null;
  }
}

function setPressed(btn, on) {
  if (!btn) return;
  btn.classList.toggle('active', !!on);
  btn.setAttribute('aria-pressed', String(!!on));
}

function stopDragFrom(el) {
  if (!el) return;
  ['mousedown', 'touchstart', 'pointerdown'].forEach(evt => {
    el.addEventListener(evt, (e) => e.stopPropagation(), true);
  });
}
 
/* FileMaker bridge: centralized script names and safe wrapper (no behavior change yet) */
const FM_SCRIPTS = Object.freeze({
  SaveState: 'Session_SaveState',
  GetState: 'Session_GetState',
  NewSession: 'Session_New',
  GridSave: 'Grid_SaveLayout',
  GridLoad: 'Grid_LoadLayout',
  GridRestore: 'Grid_RestoreDefaultLayout',
  ChatText: 'Chat_TextRequest',
  HandleAPIError: 'HandleAPIError',
  LogMessage: 'LogMessage',
  ShowJSON: 'ShowJSON',
  DeleteSession: 'Session_Delete',
  RenameSession: 'Session_Rename'
});

/**
 * Safely call a FileMaker script.
 * Accepts an object or string payload; objects are JSON-stringified.
 * Returns true on success, false on failure or when FileMaker is not available.
 */
function callFM(name, payload) {
  if (!window.FileMaker?.PerformScript) return false;
  try {
    const arg = typeof payload === 'string' ? payload : (payload != null ? JSON.stringify(payload) : '');
    window.FileMaker.PerformScript(name, arg);
    return true;
  } catch (e) {
    console.warn('FileMaker.PerformScript failed', name, e);
    return false;
  }
}

/* 
 * Function to create toast timeline container if it doesn't exist
 */
function createToastTimeline() {
  // Toasts widget owns #toast-timeline; no-op if absent
  return;
}

/*
 * Conversations helpers
 */
function filterConversations(listEl, query) {
  if (!listEl) return;
  const q = (query || '').toLowerCase();
  Array.from(listEl.children || []).forEach((item) => {
    const text = (item.textContent || '').toLowerCase();
    item.style.display = text.includes(q) ? '' : 'none';
  });
}

function attachConversationSearch(inputEl, listEl) {
  if (!inputEl || !listEl) return;
  inputEl.addEventListener('input', () => filterConversations(listEl, inputEl.value));
}

/*
 * Text chat helpers
 */

/**
 * Record a chat message into the in-memory buffer.
 * Keeps recent messages so the Text widget can render history on mount.
 */
function recordChatMessage(role, text, opts = {}) {
  if (!text) return;
  chatBuffer.push({
    role,
    text,
    ts: Date.now(),
    source: opts.source || null
  });
  // Prevent unbounded growth during long sessions
  if (chatBuffer.length > 1000) {
    chatBuffer.splice(0, chatBuffer.length - 1000);
  }
}

/**
 * Render a single chat message to the Text widget UI (if mounted).
 */
function renderChatMessage(role, text, id = null) {
  const list = document.getElementById('chat-messages');
  if (!list || !text) return;

  const row = document.createElement('div');
  row.className = `chat-message ${role}`;
  row.style.position = 'relative';
  if (id) row.setAttribute('data-id', id);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  bubble.style.position = 'relative';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'msg-close';
  closeBtn.textContent = '×';
  closeBtn.style.position = 'absolute';
  closeBtn.style.top = '-8px';
  closeBtn.style.right = '-6px';
  closeBtn.style.display = 'none';
  closeBtn.style.border = 'none';
  closeBtn.style.background = 'transparent';
  closeBtn.style.color = 'inherit';
  closeBtn.style.cursor = 'pointer';
  closeBtn.style.fontSize = '18px';
  closeBtn.style.zIndex = '2';
  closeBtn.setAttribute('aria-label', 'Delete message');
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (id) {
      deleteHistoryItem(id);
    }
  });

  bubble.addEventListener('mouseenter', () => { closeBtn.style.display = 'block'; });
  bubble.addEventListener('mouseleave', () => { closeBtn.style.display = 'none'; });

  row.appendChild(bubble);
  bubble.appendChild(closeBtn);
  list.appendChild(row);

  // autoscroll
  list.scrollTop = list.scrollHeight;
}

/**
 * Append a chat message: always store in buffer, and render if widget mounted.
 * @param {'user'|'assistant'|'system'} role
 * @param {string} text
 * @param {object} [opts]
 */
function appendChatMessage(role, text, opts = {}) {
  if (!text) return;
  recordChatMessage(role, text, opts);
  const item = appendCanonicalMessage(role, text, { api: opts.source || null });
  renderChatMessage(role, text, item?.id || null);
}

/**
 * Convert the in-memory chat history buffer to a plain text transcript.
 * Format: "[HH:MM:SS] role: message" per line.
 * Returns "(no chat history yet)" if empty.
 */
function chatHistoryToText() {
  if (!Array.isArray(chatBuffer) || chatBuffer.length === 0) {
    return "(no chat history yet)";
  }
  return chatBuffer.map(m => {
    const d = m && typeof m.ts === 'number' ? new Date(m.ts) : null;
    const time = d && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString() : '';
    const role = m?.role || 'unknown';
    const text = m?.text || '';
    return time ? `[${time}] ${role}: ${text}` : `${role}: ${text}`;
  }).join('\n');
}

/**
 * Log the current chat history as plain text to the console.
 * Returns the same text string for convenience.
 */
function logChatHistory() {
  const text = chatHistoryToText();
  return text;
}

/**
 * Return a shallow copy of the in-memory chat buffer.
 */
function getChatBuffer() {
  return Array.isArray(chatBuffer) ? chatBuffer.slice() : [];
}

/**
 * Console.log the raw chat buffer as JSON (pretty by default).
 * @param {boolean} pretty
 * @returns {string} The JSON string that was logged.
 */
function logChatBufferRaw(pretty = true) {
  const out = pretty ? JSON.stringify(getChatBuffer(), null, 2) : JSON.stringify(getChatBuffer());
  return out;
}

/**
 * Return current session state for FileMaker: id, mode, history, per-mode layouts.
 */
function getSessionState() {
  return {
    sessionId: window.__sessionId || "",
    mode: getCurrentMode(),
    history: Array.isArray(sessionHistory) ? sessionHistory.slice() : [],
    layouts: {
      docked: persistedSettings.docked || null,
      undocked: persistedSettings.undocked || null
    }
  };
}

/**
 * Upsert the unified session JSON in FileMaker via Session_SaveState.
 * Use options to minimize payload: { settings: true|false, history: true|false }.
 */
function saveSession(opts = {}) {
  const options = (opts && typeof opts === 'object') ? opts : {};
  const payload = { sessionId: window.__sessionId || "" };
  if (options.settings) {
    payload.settings = buildSessionSettingsBundle();
    // Guardrail: settings should not include layout anymore
    if (payload.settings && Object.prototype.hasOwnProperty.call(payload.settings, 'layout')) {
      try { delete payload.settings.layout; showToast('Removed settings.layout; layout must be sent at root-level.', 'tool-error', 'left', null, 6); } catch (_) {}
    }
  }
  if (options.layout) {
    payload.layout = buildSessionLayoutBundle();
  }
  if (options.history) {
    payload.history = Array.isArray(sessionHistory) ? sessionHistory.slice() : [];
  }
  return callFM(FM_SCRIPTS.SaveState, payload);
}

/**
 * Persist canonical history to FileMaker (Session_SaveState).
 * Call this on session switch or viewer close.
 */
function saveSessionState() {
  return saveSession({ history: true });
}

/* Flush history when the viewer is being closed/navigated away */
window.addEventListener('pagehide', () => {
  try { if (Array.isArray(sessionHistory) && sessionHistory.length > 0) saveSessionState(); } catch (_) {}
});

/**
 * Compute a snapshot of current grid settings without persisting.
 */
function computeCurrentSettingsSnapshot() {
  if (!grid) return null;
  const nodes = (grid.engine?.nodes || []).map(n => ({
    widget: n.el?.dataset?.widget || null,
    x: n.x, y: n.y, w: n.w, h: n.h
  }));
  return {
    version: 1,
    columns: grid.engine?.column || grid.opts?.column || 12,
    float: !!floatEnabled,
    text: !!textWidgetEl,
    toasts: !!toastsWidgetEl,
    showToolCalls: !!showToolPills,
    layout: nodes
  };
}

/**
 * Build a unified settings bundle for this session:
 * - Shared toggles (text/toasts/float/showToolCalls)
 * - Layout per mode: { docked: [...], undocked: [...] }
 */
function buildSessionSettingsBundle() {
  const toggles = getCurrentToggleSettings();
  return {
    version: 1,
    columns: grid?.engine?.column || grid?.opts?.column || 12,
    cellHeight: undefined,
    float: !!floatEnabled,
    text: !!toggles.text,
    toasts: !!toggles.toasts,
    showToolCalls: !!toggles.showToolCalls
  };
}

/**
 * Build a root-level layout bundle per mode.
 */
function buildSessionLayoutBundle() {
  const currentSnapshot = computeCurrentSettingsSnapshot();
  const currentMode = getCurrentMode();

  const dockedLayout = Array.isArray(persistedSettings.docked?.layout)
    ? persistedSettings.docked.layout
    : (currentMode === 'docked' ? (currentSnapshot?.layout || []) : []);

  const undockedLayout = Array.isArray(persistedSettings.undocked?.layout)
    ? persistedSettings.undocked.layout
    : (currentMode === 'undocked' ? (currentSnapshot?.layout || []) : []);

  return {
    docked: dockedLayout,
    undocked: undockedLayout
  };
}

/**
 * Build a minified history array (messages + tool calls/results) from sessionHistory.
 */
function buildMinifiedHistoryFromSession() {
  const out = [];
  for (const item of sessionHistory) {
    if (!item) continue;
    if (item.type === 'message') {
      out.push({
        role: item.role,
        source: item.metadata?.api ?? null,
        text: item.content ?? '',
        ts: item.ts
      });
    } else if (item.type === 'tool_call') {
      out.push({
        type: 'tool_call',
        name: item.metadata?.tool?.name || 'unknown',
        args: item.metadata?.tool?.arguments ?? null,
        call_id: item.metadata?.call_id ?? null,
        ts: item.ts
      });
    } else if (item.type === 'tool_result') {
      out.push({
        type: 'tool_result',
        call_id: item.metadata?.call_id ?? null,
        output: item.content ?? null,
        status: item.metadata?.status ?? undefined,
        ts: item.ts
      });
    }
  }
  return out;
}

/**
 * Build a minimal bootstrap payload using current mode, settings, and minified history.
 */
function buildBootstrapTestPayload() {
  const mode = getCurrentMode();
  const snapshot = computeCurrentSettingsSnapshot();
  const currentSettings = persistedSettings[mode] || snapshot || {
    version: 1,
    columns: 12,
    float: true,
    text: !!textWidgetEl,
    toasts: !!toastsWidgetEl,
    layout: []
  };

  // Build settings without embedding layout
  const settings = {
    version: currentSettings.version || 1,
    columns: currentSettings.columns || 12,
    float: !!currentSettings.float,
    text: !!currentSettings.text,
    toasts: !!currentSettings.toasts,
    showToolCalls: !!showToolPills
  };

  // Collect per-mode layouts
  const docked = Array.isArray(persistedSettings.docked?.layout)
    ? persistedSettings.docked.layout
    : (mode === 'docked' ? (snapshot?.layout || currentSettings.layout || []) : []);
  const undocked = Array.isArray(persistedSettings.undocked?.layout)
    ? persistedSettings.undocked.layout
    : (mode === 'undocked' ? (snapshot?.layout || currentSettings.layout || []) : []);

  return {
    history: buildMinifiedHistoryFromSession(),
    key: mode,
    sessionId: window.__sessionId || '',
    layout: { docked, undocked },
    settings
  };
}

/**
 * Copy minified payload to clipboard and log compact JSON to console.
 */
function copyMinifiedHistory() {
  const payload = buildBootstrapTestPayload();
  const text = JSON.stringify(payload);
  // Try modern clipboard API first
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text)
      .then(() => showToast('Copied test payload to clipboard', 'agent', 'right', null, 4))
      .catch(() => {
        // Fallback
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); showToast('Copied test payload to clipboard', 'agent', 'right', null, 4); } catch (_) {}
        document.body.removeChild(ta);
      });
  } else {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Copied test payload to clipboard', 'agent', 'right', null, 4); } catch (_) {}
    document.body.removeChild(ta);
  }
  return text;
}

/**
 * Bootstrap the app from FileMaker with session, settings, and history.
 * Accepts an object or a JSON string.
 * Seeds in-memory caches and defers layout application to initial mount.
 */
function bootstrapApp(payload) {
  try {
    const raw = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
    const data = (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'success'))
      ? (raw.success ? (raw.result || {}) : null)
      : raw;
    if (!data) {
      console.error('bootstrapApp failed: App_Init returned success=false or invalid payload');
      return false;
    }
    const mode = data.key || data.mode || (data.settings && (data.settings.key || data.settings.mode)) || 'docked';

    // Seed sessions list (sidebar and undocked widget)
    if (Array.isArray(data.sessions)) {
      setSessionList(data.sessions);
    }

    // Seed history: preserve tool_call/tool_result; buffer only message items for legacy UI
    if (Array.isArray(data.history)) {
      const incoming = [];
      const bufferMsgs = [];
      for (const m of data.history) {
        const ts =
          (m && m.ts !== undefined) ? m.ts
          : (m && m.timestamp !== undefined) ? m.timestamp
          : (m && m.time !== undefined) ? m.time
          : Date.now();

        // Canonical tool_call
        if (m && m.type === 'tool_call') {
          incoming.push({
            id: (m && m.id != null && String(m.id).trim() !== '') ? String(m.id) : createId('tc'),
            ts,
            role: 'tool',
            type: 'tool_call',
            content: (typeof m?.content === 'string' ? m.content : null),
            metadata: {
              responseId: m.responseId || null,
              call_id: m.call_id || m.id || null,
              tool: {
                name: m.name || m?.tool?.name || 'unknown',
                arguments: (m?.args ?? m?.arguments ?? m?.tool?.arguments) ?? null
              }
            }
          });
          continue;
        }

        // Canonical tool_result
        if (m && m.type === 'tool_result') {
          incoming.push({
            id: (m && m.id != null && String(m.id).trim() !== '') ? String(m.id) : createId('tr'),
            ts,
            role: 'tool',
            type: 'tool_result',
            content: (m.output ?? m.content) ?? null,
            metadata: {
              call_id: m.call_id || null,
              status: m.status || null
            }
          });
          continue;
        }

        // Message-like entries
        const role = m?.role || 'system';
        const text = typeof m?.content === 'string'
          ? m.content
          : (typeof m?.text === 'string' ? m.text : '');

        incoming.push({
          id: (m && m.id != null && String(m.id).trim() !== '') ? String(m.id) : createId('m'),
          ts,
          role,
          type: 'message',
          content: text,
          metadata: { api: m?.metadata?.api ?? m?.metadata?.source ?? m?.source ?? null }
        });

        if (text) {
          bufferMsgs.push({
            role,
            text,
            ts,
            source: m?.metadata?.api ?? m?.metadata?.source ?? m?.source ?? null
          });
        }
      }

      sessionHistory.splice(0, sessionHistory.length, ...incoming);
      trimHistory();

      chatBuffer.splice(0, chatBuffer.length, ...bufferMsgs);

      // If Text widget is already mounted, render immediately
      renderChatFromHistory();
    }

    // Cache per-mode settings (normalize debug -> toasts)
    const s = data.settings || {};
    const toasts = (s.toasts !== undefined) ? !!s.toasts : !!s.debug;
    // Accept layout only at root-level
    const layoutObj = (data.layout && typeof data.layout === 'object' && !Array.isArray(data.layout))
      ? data.layout
      : null;
    if (!layoutObj && s && typeof s.layout === 'object' && !Array.isArray(s.layout)) {
      try { showToast('[bootstrapApp] Ignored settings.layout; layout must be at the root level.', 'tool-error', 'left', null, 6); } catch (_) {}
    }

    if (layoutObj) {
      ['docked', 'undocked'].forEach((k) => {
        const arr = layoutObj[k];
        if (Array.isArray(arr)) {
          const prev = persistedSettings[k] || {};
          // Normalize numeric fields to ensure GridStack honors coordinates exactly
          const normalizedArr = Array.isArray(arr)
            ? arr.map(n => ({
                widget: String(n.widget),
                x: Number(n.x),
                y: Number(n.y),
                w: Number(n.w),
                h: Number(n.h)
              }))
            : [];

          const incomingSource = data.sessionId ? 'session' : 'machine';
          const incomingSessionId = data.sessionId || null;
          const existingSource = prev.__source || null;
          const existingSessionId = prev.__sessionId || null;

          // Do not let a machine/default payload overwrite an existing session-scoped cache
          if (existingSource === 'session' && existingSessionId && incomingSource === 'machine') {
            try { debugTrace('[bootstrapApp] skip machine override', { key: k }); } catch (_) {}
            return;
          }

          persistedSettings[k] = {
            version: s.version || prev.version || 1,
            columns: s.columns || prev.columns || 12,
            cellHeight: s.cellHeight !== undefined ? s.cellHeight : prev.cellHeight,
            float: (s.float !== undefined) ? !!s.float : !!prev.float,
            text: (s.text !== undefined) ? !!s.text : !!prev.text,
            toasts,
            showToolCalls: (typeof s.showToolCalls === 'boolean') ? !!s.showToolCalls : prev.showToolCalls,
            layout: normalizedArr,
            __source: incomingSource,
            __sessionId: incomingSessionId
          };
          try {
            localStorage.setItem(`settings:${k}`, JSON.stringify({ key: k, settings: persistedSettings[k] }));
          } catch (_) {}
          try {
            debugTrace('[bootstrapApp] cached', { key: k, md5: computeLayoutMD5(normalizedArr), layout: normalizedArr });
          } catch (_) {}
        }
      });
    }

    // Agents are managed in FileMaker; ignore any activeAgent in payload

    // Persist desired mode and session id for later application
    window.__bootstrapMode = mode;
    if (data.sessionId) {
      window.__sessionId = data.sessionId;
    }
    // Highlight the active session in any rendered lists
    highlightActiveSession(window.__sessionId || '');

    // If grid is already initialized, immediately align dock state and apply layout/toggles
    if (grid) {
      applyingFromFM = true;
      try {
        if (mode === 'docked') {
          if (!isConvosDocked && window.__dockConvos) window.__dockConvos();
        } else {
          if (isConvosDocked && window.__undockConvos) window.__undockConvos();
        }

        // Only apply cached settings if they are session-scoped for this session; otherwise request from FM
        const haveSessionScoped =
          persistedSettings[mode]
          && persistedSettings[mode].__source === 'session'
          && (persistedSettings[mode].__sessionId === (data.sessionId || window.__sessionId || null));

        let applied = false;
        if (haveSessionScoped) {
          applied = applySettingsForMode(mode);
        }

        if (!applied) {
          const loaded = loadLayoutForCurrentMode();
          if (!loaded && typeof window.__syncWidgets === 'function') {
            window.__syncWidgets();
          }
        }
      } catch (e) {
        console.warn('Immediate apply after bootstrap failed; will rely on initial mount', e);
      }
      applyingFromFM = false;
    }

    // Mark bootstrap as completed to enable post-bootstrap behaviors/logging
    window.__bootstrapDone = true;
    return true;
  } catch (e) {
    console.error('bootstrapApp failed', e);
    return false;
  }
}

/**
 * Send typed text to FileMaker for processing via Chat_TextRequest.
 * @param {string} text
 * @returns {boolean}
 */
function sendChatText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;

  if (window.FileMaker) {
    try { saveSession({ history: true }); } catch (_) {}
    const ok = callFM(FM_SCRIPTS.ChatText, {
      sessionId: window.__sessionId || "",
      prompt: trimmed
    });
    if (ok) {
      appendChatMessage('user', trimmed, { source: 'typed' });
      return true;
    } else {
      console.warn('Chat_TextRequest script not available');
    }
  }

  showToast('Text mode not available — FileMaker not connected.', 'tool-error', 'left', null, 5);
  return false;
}

/**
 * Handle Send button / Enter key
 */
function handleChatSend() {
  const input = document.getElementById('chat-input');
  if (!input) return;
  const value = input.value.trim();
  if (!value) return;

  sendChatText(value);
  input.value = '';
  // keep focus for rapid typing
  input.focus();
}

/**
 * Read file as DataURL
 * @param {File} file
 * @returns {Promise<string>}
 */
function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

/**
 * Handle image file(s) selected from the text widget
 * @param {FileList} files
 * @param {string} promptFromInput
 */
async function handleChatImageUpload(files, promptFromInput = '') {
  // Image upload not supported in text-only mode
  showToast('Image upload is not available in text-only mode.', 'tool-error', 'left', null, 5);
}

/* 
 * Function to show a toast notification
 * 
 * @param {string} message - The message to display
 * @param {string} type - The type of toast (tool-call, tool-response, tool-error, agent)
 * @param {string} side - Which side to show on (left, right)
 * @param {Object|string} jsonData - The full JSON data for FileMaker script (optional)
 * @param {number} durationSeconds - How long to show the toast in seconds (default: 5)
 */
function showToast(message, type, side, jsonData = null, durationSeconds = 5) {
  createToastTimeline();

  const timeline = document.getElementById('toast-timeline');
  if (!timeline) {
    return;
  }

  // Create a row for this toast
  const toastRow = document.createElement('div');
  toastRow.className = `toast-row ${side}`;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  // Store the auto-dismiss timeout ID so we can cancel it if needed
  let autoDismissTimeout;

  // Add click handler based on whether JSON data is provided
  // Check for non-empty string or valid object
  if (jsonData && (typeof jsonData === 'object' || (typeof jsonData === 'string' && jsonData.trim() !== ''))) {
    // Ensure jsonData is a string for FileMaker
    let jsonString = jsonData;
    if (typeof jsonData !== 'string') {
      jsonString = JSON.stringify(jsonData);
    }

    toast.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!callFM(FM_SCRIPTS.ShowJSON, jsonString)) {
        console.error('Error calling FileMaker script: ShowJSON');
      }
    });
  } else {
    // Add click to dismiss if no JSON data
    toast.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      // Cancel auto-dismiss and dismiss immediately
      if (autoDismissTimeout) {
        clearTimeout(autoDismissTimeout);
      }
      dismissToast(toastRow);
    });
  }

  // Add toast to row, then row to timeline
  toastRow.appendChild(toast);
  timeline.appendChild(toastRow);

  // Auto-dismiss after specified duration
  autoDismissTimeout = setTimeout(() => {
    dismissToast(toastRow);
  }, durationSeconds * 1000);
}

/* 
 * Function to dismiss a toast with animation
 * 
 * @param {HTMLElement} toastRow - The toast row element to dismiss
 */
function dismissToast(toastRow) {
  if (toastRow && toastRow.parentNode) {
    const toast = toastRow.querySelector('.toast');
    if (toast) {
      toast.classList.add('fade-out');
    }
    setTimeout(() => {
      if (toastRow.parentNode) {
        toastRow.parentNode.removeChild(toastRow);
      }
    }, 300);
  }
}


/* 
 * Function to display an error message to the user
 * 
 * Creates and shows an error message overlay with the specified text.
 * 
 * @param {string} message - The error message to display
 */
function showErrorMessage(message) {
  // Create error container if it doesn't exist
  let errorContainer = document.getElementById('errorContainer');
  if (!errorContainer) {
    errorContainer = document.createElement('div');
    errorContainer.id = 'errorContainer';
    document.body.appendChild(errorContainer);
  }

  // Set the error message
  errorContainer.textContent = message;
  errorContainer.style.display = 'flex';

  // Hide the error after 5 seconds
  setTimeout(() => {
    errorContainer.style.display = 'none';
  }, 5000);
}

/*
 * UI settings control from FileMaker or URL
 * Pass JSON like: {"text":true, "toasts":true}
 */
function setUISettings(updateParamsJson) {
  try {
    const settings = typeof updateParamsJson === 'string' ? JSON.parse(updateParamsJson) : (updateParamsJson || {});
    logWithSnapshot('[api] setUISettings', { payload: settings });
    const text = settings.text ?? settings.chat;
    const convos = settings.convos ?? settings.conversations ?? settings.sidebar;
    const toasts = settings.toasts ?? settings.debug_toasts ?? settings.debug;

    const btnText = document.getElementById('btn-text');
    const btnToasts = document.getElementById('btn-toasts');

    if (btnText && text !== undefined) {
      setPressed(btnText, !!text);
    }
    if (btnToasts && toasts !== undefined) {
      setPressed(btnToasts, !!toasts);
    }

    if (convos !== undefined) {
      if (convos) {
        undockConvos();
      } else {
        dockConvos();
      }
    }

    // Apply changes
    if (typeof window.__syncWidgets === 'function') {
      window.__syncWidgets();
    }
    return true;
  } catch (e) {
    console.error('Invalid settings payload for setUISettings', e);
    return false;
  }
}

/* 
 * Save current GridStack layout (x,y,w,h + widget type) to FileMaker or console.
 */
function saveCurrentLayout() {
  if (!grid) return false;
  try {
    const key = isConvosDocked ? 'docked' : 'undocked';
    const settingsSnapshot = computeCurrentSettingsSnapshot();

    logWithSnapshot('[layout] saveCurrentLayout', { key, md5: computeLayoutMD5(settingsSnapshot?.layout || []) });

    // Cache in-memory and localStorage for this mode
    persistedSettings[key] = { ...settingsSnapshot, __source: 'session', __sessionId: window.__sessionId || null };
    try {
      localStorage.setItem(`settings:${key}`, JSON.stringify({
        key,
        settings: persistedSettings[key]
      }));
    } catch (_) { }

    // Send to FileMaker (user-scoped default; FileMaker derives user via Get( Username ))
    const envelope = {
      key,
      sessionId: window.__sessionId || null,
      settings: settingsSnapshot
    };
    if (!callFM(FM_SCRIPTS.GridSave, envelope)) {
      console.warn('FileMaker not available; Layout envelope:', envelope);
    }

    return true;
  } catch (e) {
    console.error('Failed to save layout', e);
    return false;
  }
}

/*
 * Restore default layout: dock conversations, clear grid, and re-add widgets in default positions
 */
function restoreDefaultLayout() {
  try {
    const key = isConvosDocked ? 'docked' : 'undocked';
    if (window.FileMaker?.PerformScript) {
      const payload = { sessionId: window.__sessionId || "", key };
      callFM(FM_SCRIPTS.GridRestore, payload);
      return true;
    }
    // Fallback: local default behavior — text on, toasts off
    dockConvos();
    const nodes = [...(grid.engine?.nodes || [])];
    nodes.forEach(n => { if (n?.el) grid.removeWidget(n.el); });
    const btnText = document.getElementById('btn-text');
    const btnToasts = document.getElementById('btn-toasts');
    if (btnText) { btnText.classList.add('active'); btnText.setAttribute('aria-pressed', 'true'); }
    if (btnToasts) { btnToasts.classList.remove('active'); btnToasts.setAttribute('aria-pressed', 'false'); }
    syncWidgets();
    return true;
  } catch (e) {
    console.error('Failed to restore default layout', e);
    return false;
  }
}

/* 
 * Load and apply saved layout for current mode (localStorage fallback until FM is wired)
 */
function loadLayoutForCurrentMode() {
  const key = isConvosDocked ? 'docked' : 'undocked';
  try {
    // Ask FileMaker for saved layout for this mode; it should callback window.applyLoadedLayout(...)
    if (window.FileMaker?.PerformScript) {
      const payload = {
        sessionId: window.__sessionId || "",
        key
      };
      logWithSnapshot('[layout] request load', { key });
      callFM(FM_SCRIPTS.GridLoad, payload);
      // FM not wired yet: return false to allow default fallback (syncWidgets) to run
      return false;
    }

    // Fallback to cached/localStorage if FileMaker not available
    if (!persistedSettings[key]) {
      const raw = localStorage.getItem(`settings:${key}`);
      if (raw) {
        const env = JSON.parse(raw);
        if (env && env.settings && Array.isArray(env.settings.layout)) {
          persistedSettings[key] = env.settings;
        }
      }
    }
    if (persistedSettings[key]) {
      return applySettingsForMode(key);
    }
    return false;
  } catch (e) {
    console.warn('No saved settings found for', key, e);
    return false;
  }
}

/*
 * Apply a saved layout payload: rebuild widgets at saved positions/sizes
 */
function applyLayout(payload) {
  if (!grid || !payload || !Array.isArray(payload.layout)) return;
  mutatingLayout = true;
  try {
    try { debugTrace('[applyLayout] start', { mode: getCurrentMode(), md5: Array.isArray(payload.layout) ? computeLayoutMD5(payload.layout) : 'n/a', float: (typeof payload.float === 'boolean') ? !!payload.float : !!floatEnabled, layout: payload.layout }); } catch (_) {}

  // Respect float setting
  const desiredFloat = (typeof payload.float === 'boolean') ? !!payload.float : !!floatEnabled;
  if (typeof grid.float === 'function') {
    // Prevent intermediate repack while removing/adding nodes
    grid.float(false);
  }

  // Conversations docked state is determined by the current mode key; no adjustment here.

  // Remove all existing widgets (batched to prevent reflow/pack during teardown)
  const existing = [...(grid.engine?.nodes || [])];
  grid.batchUpdate();
  existing.forEach(n => n?.el && grid.removeWidget(n.el));
  toastsWidgetEl = null;
  textWidgetEl = null;
  convosWidgetEl = null;

  // Rebuild widgets from layout data (respect current toggle states)
  const toggles = getCurrentToggleSettings();
  const includeText = !!toggles.text;
  const includeToasts = !!toggles.toasts;

  // Rebuild via dispatcher
  const flags = { includeText, includeToasts };
  const nodesToAdd = Array.isArray(payload.layout) ? [...payload.layout] : [];
  nodesToAdd.sort((a, b) => (a.y - b.y) || (a.x - b.x));
  const desiredNodes = nodesToAdd.map(n => ({
    widget: String(n.widget),
    x: Number(n.x), y: Number(n.y), w: Number(n.w), h: Number(n.h)
  }));
  desiredNodes.forEach(n => {
    addWidgetByType(n.widget, { x: n.x, y: n.y, w: n.w, h: n.h, autoPosition: false }, flags);
  });
  grid.commit();
  if (typeof grid.float === 'function') {
    floatEnabled = desiredFloat;
    grid.float(desiredFloat);
  }

  // Ensure Conversations widget appears when undocked only if a saved rect exists
  if (!isConvosDocked && !convosWidgetEl) {
    const saved = getSavedWidgetRect('convo', getCurrentMode());
    if (saved) { window.__addConversationsWidget && window.__addConversationsWidget(saved); }
  }

  // Update menu button states to reflect presence
  const btnText = document.getElementById('btn-text');
  const btnToasts = document.getElementById('btn-toasts');
  if (btnText) {
    const on = !!textWidgetEl;
    btnText.classList.toggle('active', on);
    btnText.setAttribute('aria-pressed', String(on));
  }
  if (btnToasts) {
    const on = !!toastsWidgetEl;
    btnToasts.classList.toggle('active', on);
    btnToasts.setAttribute('aria-pressed', String(on));
  }

  // Enforce final positions post-commit and log actual vs desired for diagnostics
  try {
    const actual = (grid.engine?.nodes || []).map(n => ({
      widget: n?.el?.dataset?.widget || null, x: n.x, y: n.y, w: n.w, h: n.h
    }));
    const elByType = {
      toasts: toastsWidgetEl,
      text: textWidgetEl,
      convo: convosWidgetEl
    };
    desiredNodes.forEach(n => {
      const el = elByType[n.widget];
      if (el && el.gridstackNode && (el.gridstackNode.x !== n.x || el.gridstackNode.y !== n.y || el.gridstackNode.w !== n.w || el.gridstackNode.h !== n.h)) {
        grid.update(el, { x: n.x, y: n.y, w: n.w, h: n.h });
      }
    });
    const actualAfter = (grid.engine?.nodes || []).map(n => ({
      widget: n?.el?.dataset?.widget || null, x: n.x, y: n.y, w: n.w, h: n.h
    }));
    const diff = { desired: desiredNodes, actualBefore: actual, actualAfter };
    window.__lastLayoutDiff = diff;
    debugTrace('[layout:apply] enforced positions', { mode: getCurrentMode(), float: desiredFloat, diff });
  } catch (e) {
    console.warn('[layout:apply] enforcement failed', e);
  }
  } finally {
    mutatingLayout = false;
    if (prefsReady && !applyingFromFM) scheduleSaveLayout(250);
  }
}

// Helpers to apply settings/layouts from FileMaker and persist preferences
function applySettingsEnvelope(envelope) {
  const env = typeof envelope === 'string' ? parseJsonSafely(envelope, 'settings envelope') : (envelope || {});
  if (!env) return false;

  const S = env.settings || {};
  // Accept layout only at root-level
  const L = (env.layout && typeof env.layout === 'object' && !Array.isArray(env.layout))
    ? env.layout
    : null;
  if (!L && S && typeof S.layout === 'object' && !Array.isArray(S.layout)) {
    try { showToast('applySettingsEnvelope: Ignored settings.layout; use root-level "layout".', 'tool-error', 'left', null, 6); } catch (_) {}
  }

  if (!L) return false;

  const payloadSessionId =
    (typeof env.sessionId === 'string' && env.sessionId) ? env.sessionId
    : (S && typeof S.sessionId === 'string' && S.sessionId) ? S.sessionId
    : '';

  ['docked', 'undocked'].forEach((k) => {
    const arr = L[k];
    if (Array.isArray(arr)) {
      const prev = persistedSettings[k] || {};
      const toasts = (S.toasts !== undefined) ? !!S.toasts : (prev.toasts ?? !!S.debug);
      // Normalize numeric fields to ensure GridStack honors coordinates exactly
      const normalizedArr = Array.isArray(arr)
        ? arr.map(n => ({
            widget: String(n.widget),
            x: Number(n.x),
            y: Number(n.y),
            w: Number(n.w),
            h: Number(n.h)
          }))
        : [];
      persistedSettings[k] = {
        version: S.version || prev.version || 1,
        columns: S.columns || prev.columns || 12,
        cellHeight: S.cellHeight !== undefined ? S.cellHeight : prev.cellHeight,
        float: (S.float !== undefined) ? !!S.float : !!prev.float,
        text: (S.text !== undefined) ? !!S.text : !!prev.text,
        toasts,
        showToolCalls: (typeof S.showToolCalls === 'boolean') ? !!S.showToolCalls : prev.showToolCalls,
        layout: normalizedArr,
        __source: payloadSessionId ? 'session' : 'machine',
        __sessionId: payloadSessionId || null
      };
      try {
        localStorage.setItem(`settings:${k}`, JSON.stringify({ key: k, settings: persistedSettings[k] }));
      } catch (_) {}
      try { debugTrace('[applySettingsEnvelope] cached', { key: k, md5: computeLayoutMD5(normalizedArr), layout: normalizedArr }); } catch (_) {}
    }
  });

  const current = getCurrentMode();
  if (persistedSettings[current]) {
    applySettingsForMode(current);
  }
  return true;
}

function applyLoadedLayout(payload) {
  // Accept either full envelope {key, settings{...}} or direct payload {layout:[]}
  const obj = typeof payload === 'string' ? parseJsonSafely(payload, 'loaded layout') : payload;
  if (!obj) return false;

  const currentMode = getCurrentMode();
  const currentSessionId = window.__sessionId || '';

  // Detect session-scoped payloads (preferred) vs machine/default (no sessionId)
  const payloadSessionId =
    (typeof obj.sessionId === 'string' && obj.sessionId) ? obj.sessionId
    : (obj.settings && typeof obj.settings.sessionId === 'string' && obj.settings.sessionId) ? obj.settings.sessionId
    : '';

  // If payload targets a different session → ignore
  if (payloadSessionId && payloadSessionId !== currentSessionId) {
    return false;
  }

  const currentSource = persistedSettings[currentMode]?.__source || 'unknown';
  const currentHasLayout = !!(persistedSettings[currentMode] && Array.isArray(persistedSettings[currentMode].layout) && persistedSettings[currentMode].layout.length > 0);

  // If we already have a session-scoped layout for this session and incoming has no sessionId, ignore machine/default override
  if (!payloadSessionId && currentSource === 'session' && currentHasLayout) {
    return false;
  }

  // Full envelope path
  if (obj.settings || obj.key || (obj.layout && typeof obj.layout === 'object' && !Array.isArray(obj.layout))) {
    return applySettingsEnvelope(obj);
  }

  // Direct array payload path → persist into cached settings and apply via standard path
  if (Array.isArray(obj.layout)) {
    const s = ensureModeSettings(currentMode);
    s.layout = obj.layout;
    if (typeof obj.float === 'boolean') {
      s.float = !!obj.float;
    }
    s.__source = payloadSessionId ? 'session' : 'machine';
    s.__sessionId = payloadSessionId || null;
    persistedSettings[currentMode] = s;
    try {
      localStorage.setItem(`settings:${currentMode}`, JSON.stringify({ key: currentMode, settings: s }));
    } catch (_) {}

    applySettingsForMode(currentMode);
    return true;
  }

  return false;
}

function getCurrentToggleSettings() {
  const btnText = document.getElementById('btn-text');
  const btnToasts = document.getElementById('btn-toasts');
  const btnToolCalls = document.getElementById('btn-tool-calls');
  const mode = getCurrentMode();
  return {
    text: !!btnText?.classList.contains('active'),
    toasts: !!btnToasts?.classList.contains('active'),
    showToolCalls: !!btnToolCalls?.classList.contains('active'),
    float: !!floatEnabled,
    mode
  };
}

function savePreferences() {
  if (!prefsReady || applyingFromFM) return;
  // Debounce settings save to reduce redundant calls during UI toggles
  scheduleSaveSettings(0);
}




/* 
 * Initialize the application when the DOM is fully loaded
 * 
 * Bootstraps GridStack and mounts the Toasts / Text widgets based on toggles.
 */
document.addEventListener("DOMContentLoaded", () => {
  // Apply any FM callbacks that may have arrived before the module finished loading
  try {
    if (window.__pendingBootstrapPayload) {
      const p = window.__pendingBootstrapPayload;
      window.__pendingBootstrapPayload = null;
      bootstrapApp(p);
    }
  } catch (_) {}

  const sidebarEl = document.querySelector('.sidebar');

  // Show a DEVELOPMENT banner when served from local dev (e.g., Byte/Vite), regardless of FileMaker presence
  function isDevServed() {
    try {
      const isHttp = /^https?:$/.test(location.protocol);
      const host = (location.host || '').toLowerCase();
      const looksDevHost = /localhost|127\.0\.0\.1|\.local|\.lan|byte/.test(host) || (location.port === '5173');
      const isViteDev = (typeof import.meta !== 'undefined')
        && (import.meta.hot || (import.meta.env && import.meta.env.DEV));
      return (isHttp && looksDevHost) || isViteDev;
    } catch (_) {
      return false;
    }
  }
  try {
    const headerEl = document.querySelector('.app-header');
    const shouldShow = isDevServed();
    let banner = document.getElementById('env-banner');
    if (shouldShow && headerEl) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'env-banner';
        banner.className = 'env-banner';
        banner.textContent = 'DEVELOPMENT';
        headerEl.appendChild(banner);
      }
    } else if (banner) {
      banner.remove();
    }
  } catch (_) {}

  // Sidebar search wiring
  const sidebarSearchEl = document.getElementById('conversation-search');
  const sidebarListEl = document.getElementById('conversation-list');
  attachConversationSearch(sidebarSearchEl, sidebarListEl);

  // Inject white outline icons into sidebar buttons
  const sidebarDockBtn = document.getElementById('dock-convos-btn');
  const sidebarNewBtn = document.getElementById('new-conversation-btn');
  if (sidebarDockBtn) {
    sidebarDockBtn.innerHTML = '';
    const svg = createAnchorIcon(18);
    if (svg) sidebarDockBtn.appendChild(svg);
  }
  if (sidebarNewBtn) {
    sidebarNewBtn.innerHTML = '';
    const svg = createNewConvoIcon(18);
    if (svg) sidebarNewBtn.appendChild(svg);
    sidebarNewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startNewSession();
    });
  }

  // Hamburger menu elements
  const menuToggle = document.getElementById('menu-toggle');
  const menuPanel = document.getElementById('menu-panel');
  const btnText = document.getElementById('btn-text');
  const btnToasts = document.getElementById('btn-toasts');
  const btnToolCalls = document.getElementById('btn-tool-calls');
  const btnCopyMinified = document.getElementById('btn-copy-minified');
  const btnToggleFloat = document.getElementById('btn-toggle-float');
  const btnSaveLayout = document.getElementById('btn-save-layout');
  const btnRestoreLayout = document.getElementById('btn-restore-layout');
  // Inject menu (hamburger) icon SVG
  if (menuToggle) {
    menuToggle.innerHTML = '';
    const svg = createMenuIcon(33);
    if (svg) menuToggle.appendChild(svg);
  }

  // Menu toggle behavior
  menuToggle?.addEventListener('click', (e) => {
    e.stopPropagation();
    const expanded = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!expanded));
    if (menuPanel) {
      menuPanel.hidden = expanded;
    }
  });
  document.addEventListener('click', () => {
    if (!menuPanel?.hidden) {
      menuPanel.hidden = true;
      menuToggle?.setAttribute('aria-expanded', 'false');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !menuPanel?.hidden) {
      menuPanel.hidden = true;
      menuToggle?.setAttribute('aria-expanded', 'false');
    }
  });

  // Float button initial label
  if (btnToggleFloat) {
    btnToggleFloat.textContent = floatEnabled ? 'Float On' : 'Float Off';
  }

  grid = GridStack.init(
    {
      column: 12,
      float: true,
      margin: 6,
      dragHandle: '.gs-handle',
      draggable: { handle: '.gs-handle' },
      resizable: { handles: 'e,se,s,sw,w' },
      disableOneColumnMode: true
    },
    '#appGrid'
  );

  // Persist layout changes on drag/resize stop (and generic 'change')
  function __handleGridNodesChanged(evt, movedNodes) {
    if (applyingFromFM || mutatingLayout) return;
    const mode = getCurrentMode();
    const nodes = Array.isArray(movedNodes) ? movedNodes : (evt && Array.isArray(evt.nodes) ? evt.nodes : []);
    if (!nodes || nodes.length === 0) return;


    if (!prefsReady) {
      // Mark pending so we can flush once ready (covers first move/resize before init completes)
      window.__pendingLayoutDirty = true;
    }

    let touched = false;
    try {
      nodes.forEach(n => {
        const w = n?.el?.dataset?.widget;
        if (!w) return;
        updateSavedWidgetRect(w, { x: n.x, y: n.y, w: n.w, h: n.h }, mode);
        touched = true;
      });
    } catch (_) {}
    if (touched && prefsReady) {
      // Debounce layout save to reduce FM round-trips during programmatic layout changes
      scheduleSaveLayout(400);
    }
  }
  try {
    grid.on('dragstop', __handleGridNodesChanged);
    grid.on('resizestop', __handleGridNodesChanged);
    grid.on('change', __handleGridNodesChanged);
  } catch (_) {}

  function addToastsWidget(pos) {
    if (toastsWidgetEl) return;
    const mode = getCurrentMode();
    const saved = !pos ? getSavedWidgetRect('toasts', mode) : null;
    // Default: full-width below text widget (docked) or beside convo (undocked)
    const fallback = mode === 'docked'
      ? { x: 0, y: 5, w: 12, h: 3, autoPosition: true }
      : { x: 3, y: 6, w: 9, h: 4, autoPosition: true };
    const p = pos || saved || fallback;
    const el = grid.addWidget({ x: p.x, y: p.y, w: p.w, h: p.h, autoPosition: p?.autoPosition === false ? false : !!p?.autoPosition });
    const contentEl = el.querySelector('.grid-stack-item-content') || el;
    contentEl.innerHTML = `
        <div class="toasts-widget">
          <div class="gs-handle">Activity</div>
          <div class="toast-timeline" id="toast-timeline"></div>
        </div>`;
    toastsWidgetEl = el;
    el.dataset.widget = 'toasts';
    // Cache position and presence for this mode
    const node = el.gridstackNode || (grid.engine?.nodes || []).find(n => n.el === el);
    if (!mutatingLayout) { updateSavedWidgetRect('toasts', node ? { x: node.x, y: node.y, w: node.w, h: node.h } : p, mode); }
    ensureModeSettings(mode);
    persistedSettings[mode].toasts = true;
    persistModeSettings(mode);
    // Prevent dragging from inside the timeline; only header should drag
    const timelineEl = contentEl.querySelector('.toast-timeline');
    if (timelineEl) {
      stopDragFrom(timelineEl);
    }
  }

  function removeToastsWidget() {
    if (!toastsWidgetEl) return;
    const mode = getCurrentMode();
    const node = toastsWidgetEl.gridstackNode || (grid.engine?.nodes || []).find(n => n.el === toastsWidgetEl);
    if (node) {
      updateSavedWidgetRect('toasts', { x: node.x, y: node.y, w: node.w, h: node.h }, mode);
    }
    grid.removeWidget(toastsWidgetEl);
    toastsWidgetEl = null;
    ensureModeSettings(mode);
    persistedSettings[mode].toasts = false;
    persistModeSettings(mode);
  }

  function addConversationsWidget(pos) {
    if (convosWidgetEl) return;
    const mode = getCurrentMode();
    const saved = !pos ? getSavedWidgetRect('convo', mode) : null;
    const p = pos || saved;
    if (!p) return;
    const el = grid.addWidget({ x: p.x, y: p.y, w: p.w, h: p.h, autoPosition: p?.autoPosition === false ? false : !!p?.autoPosition });
    const contentEl = el.querySelector('.grid-stack-item-content') || el;
    contentEl.innerHTML = `
      <div class="conversations-widget">
        <div class="gs-handle">
          <span>Conversations</span>
          <div class="sidebar-actions">
            <button class="icon-btn header-icon dock-convos-widget-btn" title="Dock Conversations back to sidebar" aria-pressed="true"></button>
            <button class="icon-btn header-icon new-convo-btn" title="Start a new conversation"></button>
          </div>
        </div>
        <div class="sidebar-search">
          <input type="search" class="conversation-search-input" placeholder="Search conversations..." />
        </div>
        <div class="conversation-list" style="flex:1 1 auto; overflow:auto; padding:8px;"></div>
      </div>`;
    convosWidgetEl = el;
    el.dataset.widget = 'convo';
    // Cache position for this mode
    const node = el.gridstackNode || (grid.engine?.nodes || []).find(n => n.el === el);
    if (!mutatingLayout) { updateSavedWidgetRect('convo', node ? { x: node.x, y: node.y, w: node.w, h: node.h } : p, mode); }
    // prevent drag from inner content
    const listEl = contentEl.querySelector('.conversation-list');
    const btnEl = contentEl.querySelector('.new-convo-btn');
    const searchEl = contentEl.querySelector('.conversation-search-input');
    const dockBtn = contentEl.querySelector('.dock-convos-widget-btn');
    stopDragFrom(listEl);
    stopDragFrom(btnEl);
    stopDragFrom(searchEl);
    stopDragFrom(dockBtn);
    // Inject icons
    if (dockBtn) {
      dockBtn.innerHTML = '';
      const svg = createAnchorIcon(18);
      if (svg) dockBtn.appendChild(svg);
      dockBtn.addEventListener('click', () => dockConvos());
    }
    if (btnEl) {
      btnEl.innerHTML = '';
      const svg = createNewConvoIcon(18);
      if (svg) btnEl.appendChild(svg);
      btnEl.addEventListener('click', (e) => {
        e.stopPropagation();
        startNewSession();
      });
    }
    // wire search
    attachConversationSearch(searchEl, listEl);
    // populate sessions into this new widget
    renderSessionList();
    highlightActiveSession(window.__sessionId || '');
  }

  function removeConversationsWidget() {
    if (!convosWidgetEl) return;
    const mode = getCurrentMode();
    const node = convosWidgetEl.gridstackNode || (grid.engine?.nodes || []).find(n => n.el === convosWidgetEl);
    if (node) {
      updateSavedWidgetRect('convo', { x: node.x, y: node.y, w: node.w, h: node.h }, mode);
    }
    grid.removeWidget(convosWidgetEl);
    convosWidgetEl = null;
  }

  function dockConvos() {
    const sidebar = document.querySelector('.sidebar');
    const dockBtn = document.getElementById('dock-convos-btn');
    sidebar?.classList.remove('hidden');
    if (convosWidgetEl) {
      grid.removeWidget(convosWidgetEl);
      convosWidgetEl = null;
    }
    isConvosDocked = true;
    if (dockBtn) {
      dockBtn.setAttribute('aria-pressed', 'false');
      dockBtn.title = 'Undock Conversations to grid (click again to dock)';
    }
    // Apply cached docked settings if present
    if (!applySettingsForMode('docked')) {
      // fallback to legacy loader
      loadLayoutForCurrentMode();
    }
    savePreferences();
  }

  function undockConvos() {
    const sidebar = document.querySelector('.sidebar');
    const dockBtn = document.getElementById('dock-convos-btn');
    sidebar?.classList.add('hidden');
    if (!convosWidgetEl) {
      addConversationsWidget();
    }
    isConvosDocked = false;
    if (dockBtn) {
      dockBtn.setAttribute('aria-pressed', 'true');
      dockBtn.title = 'Dock Conversations back to sidebar';
    }
    // Apply cached undocked settings if present
    if (!applySettingsForMode('undocked')) {
      // fallback to legacy loader
      loadLayoutForCurrentMode();
    }
    savePreferences();
  }

  function addTextWidget(pos) {
    if (textWidgetEl) return;
    const mode = getCurrentMode();
    const saved = !pos ? getSavedWidgetRect('text', mode) : null;
    const fallback = { x: 0, y: 0, w: 12, h: 5, autoPosition: true };
    const p = pos || saved || fallback;
    const el = grid.addWidget({ x: p.x, y: p.y, w: p.w, h: p.h, autoPosition: p?.autoPosition === false ? false : !!p?.autoPosition });
    const contentEl = el.querySelector('.grid-stack-item-content') || el;
    contentEl.innerHTML = `
        <div class="text-widget">
          <div class="gs-handle">Text Chat</div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input" style="display:flex; align-items:center; gap:8px;">
            <input type="file" id="chat-image-input" accept="image/*" multiple style="display:none" />
            <button class="chat-btn" id="chat-image-btn" title="Attach image">📎</button>
            <textarea id="chat-input" rows="1" placeholder="Type a message..." style="flex:1 1 auto;"></textarea>
            <button class="chat-btn primary" id="chat-send-btn">Send</button>
          </div>
        </div>`;
    textWidgetEl = el;
    el.dataset.widget = 'text';
    // Cache position and presence for this mode
    const node = el.gridstackNode || (grid.engine?.nodes || []).find(n => n.el === el);
    if (!mutatingLayout) { updateSavedWidgetRect('text', node ? { x: node.x, y: node.y, w: node.w, h: node.h } : p, mode); }
    ensureModeSettings(mode);
    persistedSettings[mode].text = true;
    persistModeSettings(mode);

    // Wire up events
    const inputEl = contentEl.querySelector('#chat-input');
    const sendBtn = contentEl.querySelector('#chat-send-btn');
    const imageBtn = contentEl.querySelector('#chat-image-btn');
    const imageInput = contentEl.querySelector('#chat-image-input');
    const messagesEl = contentEl.querySelector('#chat-messages');

    if (sendBtn) sendBtn.addEventListener('click', handleChatSend);
    if (inputEl) {
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleChatSend();
        }
      });
      // prevent grid drag from content
      stopDragFrom(inputEl);
    }
    if (messagesEl) {
      stopDragFrom(messagesEl);
    }
    if (imageBtn && imageInput) {
      imageBtn.addEventListener('click', () => imageInput.click());
      imageInput.addEventListener('change', (e) => {
        handleChatImageUpload(e.target.files, inputEl ? inputEl.value.trim() : '');
        // do not clear input text automatically; user may want to keep it
        e.target.value = '';
      });
    }

    // Render chat from canonical history on mount; fallback to buffered text if empty
    if (Array.isArray(sessionHistory) && sessionHistory.length > 0) {
      renderChatFromHistory();
    } else if (Array.isArray(chatBuffer) && chatBuffer.length > 0) {
      chatBuffer.forEach(m => renderChatMessage(m.role, m.text));
    }
  }

  function removeTextWidget() {
    if (!textWidgetEl) return;
    const mode = getCurrentMode();
    const node = textWidgetEl.gridstackNode || (grid.engine?.nodes || []).find(n => n.el === textWidgetEl);
    if (node) {
      updateSavedWidgetRect('text', { x: node.x, y: node.y, w: node.w, h: node.h }, mode);
    }
    grid.removeWidget(textWidgetEl);
    textWidgetEl = null;
    ensureModeSettings(mode);
    persistedSettings[mode].text = false;
    persistModeSettings(mode);
  }
  
  function syncWidgets() {
    const textOn = document.getElementById('btn-text')?.classList.contains('active');
    const toastsOn = document.getElementById('btn-toasts')?.classList.contains('active');

    if (textOn) addTextWidget(); else removeTextWidget();
    if (toastsOn) addToastsWidget(); else removeToastsWidget();
    // Conversations docking is controlled by the anchor buttons
  }

  // Expose grid/widget helpers for global calls
  window.__addToastsWidget = addToastsWidget;
  window.__removeToastsWidget = removeToastsWidget;
  window.__addConversationsWidget = addConversationsWidget;
  window.__removeConversationsWidget = removeConversationsWidget;
  window.__addTextWidget = addTextWidget;
  window.__removeTextWidget = removeTextWidget;
  window.__dockConvos = dockConvos;
  window.__undockConvos = undockConvos;
  window.__syncWidgets = syncWidgets;
  
  // Toggle buttons
  btnText?.addEventListener('click', (e) => {
    e.stopPropagation();
    logWithSnapshot('[ui] click', { trigger: 'btn-text:pre' });
    const on = !btnText.classList.contains('active');
    setPressed(btnText, on);
    syncWidgets();
    savePreferences();
    logWithSnapshot('[ui] click', { trigger: 'btn-text:post' });
  });
  btnToasts?.addEventListener('click', (e) => {
    e.stopPropagation();
    logWithSnapshot('[ui] click', { trigger: 'btn-toasts:pre' });
    const on = !btnToasts.classList.contains('active');
    setPressed(btnToasts, on);
    syncWidgets();
    savePreferences();
    logWithSnapshot('[ui] click', { trigger: 'btn-toasts:post' });
  });
  // Show Tool Calls toggle
  btnToolCalls?.addEventListener('click', (e) => {
    e.stopPropagation();
    logWithSnapshot('[ui] click', { trigger: 'btn-tool-calls:pre' });
    const on = !btnToolCalls.classList.contains('active');
    setPressed(btnToolCalls, on);
    showToolPills = on;
    renderChatFromHistory();
    savePreferences();
    logWithSnapshot('[ui] click', { trigger: 'btn-tool-calls:post' });
  });

  // Copy Test Payload button
  btnCopyMinified?.addEventListener('click', (e) => {
    e.stopPropagation();
    logWithSnapshot('[ui] click', { trigger: 'btn-copy-minified' });
    copyMinifiedHistory();
  });

  // Float toggle
  btnToggleFloat?.addEventListener('click', (e) => {
    e.stopPropagation();
    logWithSnapshot('[ui] click', { trigger: 'btn-toggle-float:pre' });
    floatEnabled = !floatEnabled;
    if (typeof grid.float === 'function') {
      grid.float(floatEnabled);
    } else {
      // fallback: update option (may not reflow immediately in older versions)
      grid?.opts && (grid.opts.float = floatEnabled);
    }
    btnToggleFloat.textContent = floatEnabled ? 'Float On' : 'Float Off';
    savePreferences();
    logWithSnapshot('[ui] click', { trigger: 'btn-toggle-float:post' });
  });

  // Save/Restore
  btnSaveLayout?.addEventListener('click', (e) => { e.stopPropagation(); logWithSnapshot('[ui] click', { trigger: 'btn-save-layout' }); saveCurrentLayout(); });
  btnRestoreLayout?.addEventListener('click', (e) => { e.stopPropagation(); logWithSnapshot('[ui] click', { trigger: 'btn-restore-layout' }); restoreDefaultLayout(); });

  document.getElementById('dock-convos-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    logWithSnapshot('[ui] click', { trigger: 'dock-convos-btn' });
    if (isConvosDocked) undockConvos(); else dockConvos();
  });

  // Render sessions list if we already have any
  renderSessionList();

  // Initial mount: honor bootstrap mode if provided; default to docked
  loadPersistedSettings();
  const bootMode = window.__bootstrapMode || 'docked';
  if (bootMode === 'docked') {
    dockConvos();
  } else {
    undockConvos();
  }
  prefsReady = true;
});
