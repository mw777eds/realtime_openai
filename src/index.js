import { showIcon, createAnchorIcon, createNewConvoIcon, createMenuIcon } from './icons.js';
import { GridStack } from 'gridstack';
import 'gridstack/dist/gridstack.min.css';

/* 
 * Canvas-related variables for the audio waveform visualization
 * canvas: The HTML canvas element
 * ctx: The 2D rendering context
 * animationId: Reference to the animation frame for cancellation
 */
let canvas;
let ctx;
let animationId;
let grid = null;
let realtimeWidgetEl = null;
let toastsWidgetEl = null;
let textWidgetEl = null;
let convosWidgetEl = null;
let isConvosDocked = true;
let floatEnabled = true;
let waveformResizeObserver = null;

/* Persisted per-mode settings cached in the web app */
let persistedSettings = { docked: null, undocked: null };

/* In-memory chat buffer to retain messages while Text widget is hidden */
const chatBuffer = [];
const HISTORY_MAX_ITEMS = 400;
const sessionHistory = [];
let showToolPills = false;
let prefsReady = false;
let applyingFromFM = false;

/* Sessions list (for sidebar and undocked Conversations widget) */
window.__sessions = window.__sessions || []; // [{id, title}]
function setSessionList(list) {
  if (!Array.isArray(list)) return;
  window.__sessions = list.map(it => ({
    id: String(it.id || it.sessionId || ''),
    title: String(it.title || it.name || it.id || '')
  })).filter(it => it.id);
  renderSessionList();
}

function highlightActiveSession(sessionId) {
  const all = document.querySelectorAll('.conversation-item');
  all.forEach(el => {
    const sid = el.getAttribute('data-session-id');
    el.classList.toggle('active', !!sessionId && sid === sessionId);
  });
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
      row.textContent = s.title || s.id;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        switchSession(s.id);
      });
      container.appendChild(row);
    }
  });

  highlightActiveSession(window.__sessionId || '');
}

/* Request full session bundle from FileMaker */
function requestSessionState(sessionId) {
  if (!window.FileMaker?.PerformScript) return false;
  try {
    window.FileMaker.PerformScript('Session_GetState', JSON.stringify({ sessionId }));
    return true;
  } catch (e) {
    console.warn('Session_GetState failed', e);
    return false;
  }
}

/* Switch current session: flush current, then request next */
function switchSession(newSessionId) {
  const current = window.__sessionId || '';
  if (!newSessionId || newSessionId === current) return false;

  try { saveSession({ history: true, settings: true }); } catch (_) {}
  window.__sessionId = newSessionId;
  highlightActiveSession(newSessionId);
  // Clear UI chat view immediately (optional)
  try {
    const list = document.getElementById('chat-messages');
    if (list) list.innerHTML = '';
  } catch (_) {}
  requestSessionState(newSessionId);
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
    // Expect same shape we already use in bootstrapApp: { history, layout?, settings?, key?, sessionId? }
    bootstrapApp(payload);
    highlightActiveSession(window.__sessionId || '');
    return true;
  } catch (e) {
    console.error('applySessionState failed', e);
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
  const item = {
    id: createId('m'),
    ts: Date.now(),
    role,
    type: 'message',
    content: text,
    metadata
  };
  sessionHistory.push(item);
  // Ensure Conversations widget appears when undocked even if omitted from layout
  if (!isConvosDocked && !convosWidgetEl) {
    const saved = getSavedWidgetRect('convo', getCurrentMode());
    window.__addConversationsWidget && window.__addConversationsWidget(saved || DEFAULT_POS.convo);
  }
  trimHistory();
  return item;
}

function appendToolCall(name, args, call_id, responseId) {
  sessionHistory.push({
    id: createId('tc'),
    ts: Date.now(),
    role: 'tool',
    type: 'tool_call',
    content: null,
    metadata: {
      responseId: responseId || null,
      call_id: call_id || null,
      tool: { name: name || 'unknown', arguments: args ?? null }
    }
  });
  trimHistory();
}

function appendToolResult(call_id, output, status = 'success', error = null) {
  sessionHistory.push({
    id: createId('tr'),
    ts: Date.now(),
    role: 'tool',
    type: 'tool_result',
    content: output ?? null,
    metadata: {
      call_id: call_id || null,
      status,
      error
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
      try { window.FileMaker.PerformScript('ShowJSON', JSON.stringify(data)); return; } catch (_) {}
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
  for (const item of sessionHistory) {
    if (item.type === 'message') {
      renderChatMessage(item.role, item.content, item.id);
    } else if ((item.type === 'tool_call' || item.type === 'tool_result') && showToolPills) {
      const label = item.type === 'tool_call'
        ? `Tool call: ${item?.metadata?.tool?.name || 'unknown'}`
        : `Tool result: ${item?.metadata?.tool?.name || ''}`.trim();
      renderToolPill(label, item, item.id);
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
      voice: !!realtimeWidgetEl,
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
    voice: (r) => flags.includeVoice && window.__addRealtimeWidget && window.__addRealtimeWidget(r),
    toasts: (r) => flags.includeToasts && window.__addToastsWidget && window.__addToastsWidget(r),
    text: (r) => flags.includeText && window.__addTextWidget && window.__addTextWidget(r),
    convo: (r) => (!isConvosDocked) && window.__addConversationsWidget && window.__addConversationsWidget(r)
  };
  const fn = adders[type];
  if (fn) fn(rect);
}

/* Centralized defaults for widget positions/sizes (Step 5) */
const DEFAULT_POS = Object.freeze({
  voice: { x: 0, y: 0, w: 4, h: 4 },
  toasts: { x: 8, y: 0, w: 4, h: 6 },
  text: { x: 0, y: 12, w: 12, h: 6 },
  convo: { x: 0, y: 0, w: 3, h: 8 }
});

/* Rebuild grid from a layout array (+ float), respecting current dock state for convo */
function rebuildFromLayout(layout = [], float = floatEnabled, options = {}) {
  if (!grid) return;

  if (typeof float === 'boolean' && typeof grid.float === 'function') {
    floatEnabled = float;
    grid.float(floatEnabled);
  }

  const includeVoice = options.includeVoice !== undefined ? !!options.includeVoice : true;
  const includeText = options.includeText !== undefined ? !!options.includeText : true;
  const includeToasts = options.includeToasts !== undefined ? !!options.includeToasts : true;

  // If tearing down existing voice widget, silence/cleanup Realtime to preserve mute across rebuilds
  if (realtimeWidgetEl) {
    try {
      if (audioEl && audioEl.srcObject) {
        audioEl.srcObject.getAudioTracks().forEach(t => t.enabled = false);
      }
      if (audioTrack) audioTrack.enabled = false;
      if (audioEl) audioEl.muted = true;
    } catch (_) {}
    cleanupWebRTC();
  }

  // Remove all existing widgets
  const existing = [...(grid.engine?.nodes || [])];
  existing.forEach(n => n?.el && grid.removeWidget(n.el));
  realtimeWidgetEl = null;
  toastsWidgetEl = null;
  textWidgetEl = null;
  convosWidgetEl = null;

  // Add widgets back based on layout (respect toggles) via dispatcher
  const flags = { includeVoice, includeText, includeToasts };
  layout.forEach(n => {
    addWidgetByType(n.widget, { x: n.x, y: n.y, w: n.w, h: n.h }, flags);
  });
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
  const btnVoice = document.getElementById('btn-voice');
  const btnText = document.getElementById('btn-text');
  const btnToasts = document.getElementById('btn-toasts');
  const btnToolCalls = document.getElementById('btn-tool-calls');
  if (btnVoice) {
    setPressed(btnVoice, !!settings.voice);
  }
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

  rebuildFromLayout(settings.layout, settings.float, {
    includeVoice: !!settings.voice,
    includeText: !!settings.text,
    includeToasts: !!settings.toasts
  });
  return true;
}


/* 
 * Expose functions to FileMaker
 * These functions can be called from FileMaker scripts to control
 * the WebRTC connection and audio transmission
 */
window.initializeWebRTC = initializeWebRTC;
window.startAudioTransmission = startAudioTransmission;
window.stopAudioTransmission = stopAudioTransmission;
window.sendResponseCancel = sendResponseCancel;
window.stopLLMGeneration = stopLLMGeneration;
window.hasActiveResponse = hasActiveResponse;
window.cleanupWebRTC = cleanupWebRTC;
window.sendToolResponse = sendToolResponse;
window.createModelResponse = createModelResponse;
window.updateSession = updateSession;
window.showToast = showToast;
window.sendContainerImageToRealtime = sendContainerImageToRealtime;
window.sendTextToRealtime = sendTextToRealtime;
window.setUISettings = setUISettings;
window.getChatHistoryText = chatHistoryToText;
window.logChatHistory = logChatHistory;
window.getChatBuffer = getChatBuffer;
window.logChatBufferRaw = logChatBufferRaw;
window.bootstrapApp = bootstrapApp;
window.applyRealtimeInit = applyRealtimeInit;
window.ensureRealtimeReady = ensureRealtimeReady;
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

const DEFAULT_MODALITIES = ["text", "audio"];

let defaultResponseModalities = [...DEFAULT_MODALITIES];
let currentSessionConfig = null;
let toolsEnabled = false;

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
  RealtimeInit: 'Realtime_Init',
  ChatText: 'Chat_TextRequest',
  CallTools: 'CallTools',
  HandleAPIError: 'HandleAPIError',
  LogMessage: 'LogMessage',
  ShowJSON: 'ShowJSON'
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

function deepMerge(target = {}, source = {}) {
  const output = Array.isArray(target) ? [...target] : { ...target };

  if (!source || typeof source !== 'object') {
    return output;
  }

  Object.keys(source).forEach((key) => {
    const sourceValue = source[key];

    if (Array.isArray(sourceValue)) {
      output[key] = [...sourceValue];
    } else if (sourceValue && typeof sourceValue === 'object') {
      const base = output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])
        ? output[key]
        : {};
      output[key] = deepMerge(base, sourceValue);
    } else if (sourceValue !== undefined) {
      output[key] = sourceValue;
    }
  });

  return output;
}

function safeStr(v, max = 800) {
  try {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > max ? s.slice(0, max) + '…' : s;
  } catch (_) {
    try { return String(v); } catch (__){ return ''; }
  }
}


/**
 * Safely send a JSON event over the RTCDataChannel with basic backpressure handling.
 * Returns true if queued/sent, false if the channel is not open or serialization fails.
 */
function dcSendJSONSafe(obj, opts = {}) {
  if (!dc || dc.readyState !== 'open') return false;
  try {
    // Normalize any conversation.item.create content types and fix lingering 'output_text'
    const normalized = (typeof normalizeConversationCreateEvent === 'function')
      ? normalizeConversationCreateEvent(obj)
      : obj;
    let json = JSON.stringify(normalized);
    if (json.includes('"type":"output_text"')) {
      json = json.replace(/"type"\s*:\s*"output_text"/g, '"type":"text"');
    }

    // Ensure a sane low threshold and wait if the buffer is high (especially after large image sends)
    try { dc.bufferedAmountLowThreshold = 65536; } catch (_) {}
    const highNow = dc.bufferedAmount > 131072; // 128KB
    if (highNow || opts.highVolume) {
      if (dc.bufferedAmount > (dc.bufferedAmountLowThreshold || 65536)) {
        let sent = false;
        const onLow = () => {
          if (sent) return;
          sent = true;
          try { dc.send(json); } catch (_) {}
          dc.removeEventListener('bufferedamountlow', onLow);
        };
        dc.addEventListener('bufferedamountlow', onLow, { once: true });
        setTimeout(() => {
          if (sent) return;
          try { dc.send(json); } catch (_) {}
          dc.removeEventListener('bufferedamountlow', onLow);
        }, 800);
        return true;
      }
    }
    dc.send(json);
    return true;
  } catch (e) {
    console.warn('dcSendJSONSafe failed', e);
    return false;
  }
}

/**
 * Normalize conversation.item.create event content types for Realtime.
 * Maps any 'output_text' parts to 'text' to satisfy the Realtime schema.
 */
function normalizeConversationCreateEvent(ev) {
  try {
    if (ev && ev.type === 'conversation.item.create' && ev.item && ev.item.type === 'message' && Array.isArray(ev.item.content)) {
      ev.item.content = ev.item.content.map((part) => {
        if (part && part.type === 'output_text') {
          return { ...part, type: 'text' };
        }
        return part;
      });
    }
  } catch (_) {}
  return ev;
}

function prepareSessionConfiguration(instructions, toolsStr, toolChoice, sessionConfig) {
  let tools = [];

  const parsedTools = parseJsonSafely(toolsStr, 'tools');
  if (Array.isArray(parsedTools)) {
    tools = parsedTools;
  }

  const additionalConfig = parseJsonSafely(sessionConfig, 'session configuration') || {};



  let defaultModalitiesOverride = null;
  if (additionalConfig.defaultResponseModalities) {
    defaultModalitiesOverride = additionalConfig.defaultResponseModalities;
    delete additionalConfig.defaultResponseModalities;
  } else if (additionalConfig.default_response_modalities) {
    defaultModalitiesOverride = additionalConfig.default_response_modalities;
    delete additionalConfig.default_response_modalities;
  }

  if (Array.isArray(additionalConfig.tools)) {
    tools = additionalConfig.tools;
    delete additionalConfig.tools;
  }


  const defaultSessionConfig = {
    instructions: instructions || "You are a helpful AI assistant.",
    tools,
    tool_choice: "none",
    input_audio_transcription: {
      model: "gpt-4o-mini-transcribe"
    },
    modalities: [...DEFAULT_MODALITIES],
    voice: "verse"
  };

  const finalSessionConfig = deepMerge(defaultSessionConfig, additionalConfig);

  if (!Array.isArray(finalSessionConfig.modalities) || finalSessionConfig.modalities.length === 0) {
    finalSessionConfig.modalities = [...DEFAULT_MODALITIES];
  }

  finalSessionConfig.tools = Array.isArray(finalSessionConfig.tools) ? finalSessionConfig.tools : [];

  const defaultModalities = Array.isArray(defaultModalitiesOverride) && defaultModalitiesOverride.length > 0
    ? defaultModalitiesOverride
    : finalSessionConfig.modalities;

  return {
    sessionConfig: finalSessionConfig,
    defaultModalities
  };
}

function getResponseModalities(modalitiesOverride) {
  if (Array.isArray(modalitiesOverride) && modalitiesOverride.length > 0) {
    return modalitiesOverride;
  }

  return defaultResponseModalities && defaultResponseModalities.length > 0
    ? defaultResponseModalities
    : [...DEFAULT_MODALITIES];
}

function normalizeModalitiesList(modalities) {
  if (Array.isArray(modalities)) {
    return modalities
      .map(modality => typeof modality === 'string' ? modality.trim() : modality)
      .filter(modality => typeof modality === 'string' && modality.length > 0);
  }

  if (typeof modalities === 'string') {
    try {
      const parsed = JSON.parse(modalities);
      return normalizeModalitiesList(parsed);
    } catch (error) {
      return modalities
        .split(',')
        .map(modality => modality.trim())
        .filter(modality => modality.length > 0);
    }
  }

  return null;
}

function normalizeImagePayload(imagePayload) {
  if (!imagePayload || typeof imagePayload !== 'object') {
    return null;
  }

  let base64Data = imagePayload.base64 || imagePayload.imageBase64 || imagePayload.image_base64 || null;
  let mimeType = imagePayload.mimeType || imagePayload.mime_type || imagePayload.contentType || null;

  if (!base64Data && typeof imagePayload.dataUrl === 'string') {
    const match = imagePayload.dataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (match) {
      mimeType = mimeType || match[1];
      base64Data = match[2];
    }
  }

  if (!base64Data && typeof imagePayload.data_url === 'string') {
    const match = imagePayload.data_url.match(/^data:(.+?);base64,(.+)$/);
    if (match) {
      mimeType = mimeType || match[1];
      base64Data = match[2];
    }
  }

  if (!base64Data || typeof base64Data !== 'string') {
    return null;
  }

  base64Data = base64Data.replace(/\s+/g, '');

  return {
    base64Data,
    mimeType: mimeType || 'image/png'
  };
}

async function sendContainerImageToRealtime(imagePayload, requestResponse = true) {
  if (!dc || dc.readyState !== "open") {
    console.error("Data channel not ready for sending image context");
    return false;
  }

  let payload = imagePayload;
  if (typeof imagePayload === 'string') {
    payload = parseJsonSafely(imagePayload, 'image payload') || { dataUrl: imagePayload };
  }

  const normalized = normalizeImagePayload(payload);
  if (!normalized) {
    console.error("Invalid image payload supplied to sendContainerImageToRealtime");
    return false;
  }

  // Attempt client-side downscaling/compression to fit RTCDataChannel limits
  const originalDataUrl = payload?.dataUrl || `data:${normalized.mimeType || 'image/png'};base64,${normalized.base64Data}`;
  async function downscaleDataUrlToLimit(dataUrl, maxChars = 900000, maxW = 1280, maxH = 1280) {
    // Load image reliably, then draw into canvas and compress to stay under maxChars
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = 'anonymous';
      i.onload = () => resolve(i);
      i.onerror = (e) => reject(e);
      i.src = dataUrl;
    });

    let w = img.naturalWidth || img.width || 1;
    let h = img.naturalHeight || img.height || 1;

    // Clamp to bounding box
    const scale1 = Math.min(1, maxW / w, maxH / h);
    let targetW = Math.max(1, Math.round(w * scale1));
    let targetH = Math.max(1, Math.round(h * scale1));

    const canvas = document.createElement('canvas');
    const ctx2 = canvas.getContext('2d');
    let quality = 0.82;
    const outType = 'image/jpeg'; // favor JPEG for smaller payloads

    function renderToDataUrl(width, height, q) {
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      ctx2.clearRect(0, 0, canvas.width, canvas.height);
      ctx2.drawImage(img, 0, 0, canvas.width, canvas.height);
      try {
        return canvas.toDataURL(outType, q);
      } catch (_) {
        return canvas.toDataURL(); // fallback
      }
    }

    let out = renderToDataUrl(targetW, targetH, quality);
    let base64 = (out.split(',')[1] || '');
    let iter = 0;

    // Iterate reducing quality and occasionally size until under limit or max attempts
    while (base64.length > maxChars && iter < 6) {
      iter += 1;
      if (quality > 0.55) {
        quality -= 0.12;
      } else {
        targetW = Math.max(64, Math.round(targetW * 0.8));
        targetH = Math.max(64, Math.round(targetH * 0.8));
      }
      out = renderToDataUrl(targetW, targetH, quality);
      base64 = (out.split(',')[1] || '');
    }
    return out;
  }

  let processedDataUrl = originalDataUrl;
  try {
    processedDataUrl = await downscaleDataUrlToLimit(originalDataUrl, 160000, 1024, 1024);
  } catch (e) {
    console.warn('Image downscale failed; will try sending original size', e);
  }
  const wasResized = processedDataUrl !== originalDataUrl;
  try {
    const m = processedDataUrl.match(/^data:(.+?);base64,(.+)$/);
    if (m) {
      normalized.mimeType = m[1];
      normalized.base64Data = m[2];
    }
  } catch (_) {}

  const content = [];

  const promptText = payload && typeof payload.prompt === 'string'
    ? payload.prompt
    : (typeof payload.text === 'string' ? payload.text : null);

  if (promptText && promptText.trim() !== '') {
    content.push({
      type: "input_text",
      text: promptText.trim()
    });
  }

  const imageContent = {
    type: "input_image",
    image_url: processedDataUrl
  };

  // Hint lower detail if we resized to save tokens
  if (wasResized) {
    imageContent.detail = 'low';
  }

  if (payload && payload.metadata && typeof payload.metadata === 'object') {
    imageContent.metadata = payload.metadata;
  }

  content.push(imageContent);

  const conversationEvent = {
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content
    }
  };

  // Fallback guard if still oversized after client-side resize (≤ ~160k base64 chars ≈ ~120KB)
  {
    const base64Len = (processedDataUrl.split(',')[1] || '').length;
    if (base64Len > 160000) {
      console.warn("Image still too large for RTCDataChannel after resize:", base64Len);
      showToast("Image too large for realtime channel even after resizing. Try a smaller image.", "tool-error", "left", null, 6);
      return false;
    }
  }

  // Ensure event JSON fits RTC maxMessageSize by further downscaling if necessary
  {
    const maxMsg = (pc && pc.sctp && typeof pc.sctp.maxMessageSize === 'number') ? pc.sctp.maxMessageSize : 240000;
    let jsonLen = JSON.stringify(conversationEvent).length;
    let attempts = 0;
    let limitChars = 160000;
    let maxW = 1024, maxH = 1024;

    while (jsonLen > Math.max(16384, maxMsg - 4096) && attempts < 3) {
      attempts += 1;
      // tighten constraints
      limitChars = Math.max(60000, Math.round(limitChars * 0.7));
      maxW = Math.max(320, Math.round(maxW * 0.75));
      maxH = Math.max(320, Math.round(maxH * 0.75));
      try {
        processedDataUrl = await downscaleDataUrlToLimit(processedDataUrl, limitChars, maxW, maxH);
        const m2 = processedDataUrl.match(/^data:(.+?);base64,(.+)$/);
        if (m2) {
          normalized.mimeType = m2[1];
          normalized.base64Data = m2[2];
        }
        // rebuild content with resized image
        const newImageContent = { type: "input_image", image_url: processedDataUrl };
        newImageContent.detail = 'low';
        if (payload && payload.metadata && typeof payload.metadata === 'object') {
          newImageContent.metadata = payload.metadata;
        }
        const contentNew = [];
        if (promptText && promptText.trim() !== '') {
          contentNew.push({ type: "input_text", text: promptText.trim() });
        }
        contentNew.push(newImageContent);
        conversationEvent.item.content = contentNew;

        jsonLen = JSON.stringify(conversationEvent).length;
      } catch (_) {
        break;
      }
    }

    if (jsonLen > Math.max(16384, maxMsg - 4096)) {
      console.warn("Event JSON still too large for RTCDataChannel after resizing:", jsonLen, ">", maxMsg);
      showToast("Image too large to send after resizing. Try a smaller image.", "tool-error", "left", null, 6);
      return false;
    }
  }

  // Log concise info for debugging image sends
  {
    const __b64Len = (processedDataUrl.split(',')[1] || '').length;
    const __estKB = Math.round(__b64Len * 0.75 / 1024);
    console.log(`Sending image to Realtime (~${__estKB} KB, resized: ${wasResized ? 'yes' : 'no'}, type: ${normalized.mimeType || 'unknown'})`);
    console.log('RTC maxMessageSize:', pc?.sctp?.maxMessageSize);
    console.log('Event JSON size (bytes):', JSON.stringify(conversationEvent).length);
  }

  const okImage = dcSendJSONSafe(conversationEvent, { highVolume: true });
  if (!okImage) {
    console.error("Failed to send image message over data channel");
    showToast("Failed to send image to assistant. Try again.", "tool-error", "left", null, 6);
    return false;
  }
  console.log("Image message sent to Realtime");

  // Defer tool enabling slightly to avoid backpressure after large image payload
  setTimeout(() => {
    try {
      if (dc && dc.readyState === 'open' && !toolsEnabled) {
        enableToolsIfDisabled();
      }
    } catch (_) {}
  }, 250);

  const shouldRequestResponse = typeof payload?.requestResponse === 'boolean'
    ? payload.requestResponse
    : requestResponse;

  if (shouldRequestResponse) {
    const normalizedModalitiesOverride = normalizeModalitiesList(payload?.modalities) || payload?.modalities;
    const modalities = getResponseModalities(normalizedModalitiesOverride);
    const responseCreateEvent = {
      type: "response.create",
      response: {
        modalities
      }
    };
    setTimeout(() => {
      try {
        if (dc && dc.readyState === 'open') {
          dcSendJSONSafe(responseCreateEvent);
        }
      } catch (err) {
        console.warn("Failed to send response.create after image:", err);
      }
    }, 100);
  }

  // Mark time so we can log the next model output as the image result
  window.__lastImageSendAt = Date.now();

  showToast("Shared image context with assistant", "tool-response", "left", null, 4);

  return true;
}

/*
 * Function to send tool response back to OpenAI
 *
 * This function takes the output from a tool execution in FileMaker
 * and sends it back to the OpenAI API through the WebRTC data channel.
 * 
 * @param {string} toolResponse - JSON string containing the tool response data
 */
function sendToolResponse(toolResponse) {
  toolResponse = JSON.parse(toolResponse);

  if (!toolResponse.call_id) {
    console.error("Missing call_id in toolResponse");
    return;
  }

  if (dc && dc.readyState === "open") {
    const response = {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: toolResponse.call_id,
        output: JSON.stringify(toolResponse.output)
      }
    };

    dcSendJSONSafe(response);
    // Append tool_result to canonical history
    try {
      appendToolResult(toolResponse.call_id, toolResponse.output, 'success');
      if (showToolPills) {
        renderChatFromHistory();
      }
    } catch (_) {}
  } else {
    console.error("Data channel not ready for tool response. State:", dc ? dc.readyState : "no dc");
  }
}

/* 
 * Function to trigger model response after tools
 * 
 * After a tool has been executed and its response sent back to OpenAI,
 * this function requests the model to generate a new response.
 * It also updates the UI to show the listening icon.
 */
function createModelResponse() {
  if (dc && dc.readyState === "open") {
    /* Switch from thinking to listening icon */
    if (!isPaused) {
      showIcon('ear');
    }

    const responseCreateEvent = {
      type: "response.create",
      response: {
        modalities: getResponseModalities()
      }
    };
    dcSendJSONSafe(responseCreateEvent);
  } else {
    console.error("Data channel not ready for response creation");
  }
}

/* 
 * Function to update session configuration
 * 
 * Updates specific session parameters by sending a session.update event
 * to the OpenAI API. Only the provided parameters will be updated.
 * Supports: instructions, temperature, max_response_output_tokens, tools, modalities, speed
 * Note: voice cannot be changed during an active session.
 * 
 * @param {string} updateParamsJson - JSON string containing session parameters to update
 * @returns {boolean} - True if update was sent, false otherwise
 */
function updateSession(updateParamsJson) {
  if (!dc || dc.readyState !== "open") {
    console.error("Data channel not ready for session update");
    return false;
  }

  try {
    const parsedUpdate = parseJsonSafely(updateParamsJson, 'session update');

    if (!parsedUpdate || typeof parsedUpdate !== 'object') {
      console.error("Session update payload must be a JSON object");
      return false;
    }


    let newDefaultModalities = null;
    if (Object.prototype.hasOwnProperty.call(parsedUpdate, 'defaultResponseModalities')) {
      newDefaultModalities = normalizeModalitiesList(parsedUpdate.defaultResponseModalities);
      delete parsedUpdate.defaultResponseModalities;
    }
    if (Object.prototype.hasOwnProperty.call(parsedUpdate, 'default_response_modalities')) {
      const override = normalizeModalitiesList(parsedUpdate.default_response_modalities);
      newDefaultModalities = override || newDefaultModalities;
      delete parsedUpdate.default_response_modalities;
    }

    const allowedParams = new Set([
      'instructions',
      'temperature',
      'max_response_output_tokens',
      'tools',
      'modalities',
      'speed',
      'turn_detection',
      'input_audio_transcription',
      'input_audio_format',
      'output_audio_format',
      'voice',
      'response_format',
      'conversation',
      'tool_choice'
    ]);

    const updateParams = {};
    const invalidParams = [];

    Object.keys(parsedUpdate).forEach((key) => {
      if (allowedParams.has(key)) {
        updateParams[key] = parsedUpdate[key];
      } else {
        invalidParams.push(key);
      }
    });

    if (invalidParams.length > 0) {
      console.warn("Invalid session parameters ignored:", invalidParams);
    }

    if (typeof updateParams.tools === 'string') {
      const normalizedTools = parseJsonSafely(updateParams.tools, 'session tools update');
      if (Array.isArray(normalizedTools)) {
        updateParams.tools = normalizedTools;
      } else {
        console.warn("Ignoring tools update; expected an array.");
        delete updateParams.tools;
      }
    }

    if (updateParams.tools && !Array.isArray(updateParams.tools)) {
      console.warn("Ignoring tools update; expected an array.");
      delete updateParams.tools;
    }


    const normalizedModalities = normalizeModalitiesList(updateParams.modalities);
    if (normalizedModalities && normalizedModalities.length > 0) {
      updateParams.modalities = normalizedModalities;
      defaultResponseModalities = [...normalizedModalities];
    } else if (updateParams.modalities !== undefined) {
      console.warn("Ignoring modalities update; expected an array or comma-separated string.");
      delete updateParams.modalities;
    }

    if (newDefaultModalities && newDefaultModalities.length > 0) {
      defaultResponseModalities = [...newDefaultModalities];
    } else if (newDefaultModalities && newDefaultModalities.length === 0) {
      defaultResponseModalities = [...DEFAULT_MODALITIES];
    }

    if (Object.keys(updateParams).length === 0) {
      if (newDefaultModalities) {
        return true;
      }
      console.error("No valid parameters provided for session update");
      return false;
    }

    const sessionUpdateEvent = {
      type: "session.update",
      session: updateParams
    };

    if (!dcSendJSONSafe(sessionUpdateEvent)) {
      console.warn("Data channel send failed in updateSession");
      return false;
    }

    currentSessionConfig = deepMerge(currentSessionConfig || {}, updateParams);

    return true;
  } catch (error) {
    console.error("Failed to update session:", error);
    return false;
  }
}

function enableToolsIfDisabled() {
  if (toolsEnabled) return;
  toolsEnabled = true;
  try {
    updateSession(JSON.stringify({ tool_choice: 'auto' }));
  } catch (_) {}
}

/* 
 * Function to start audio transmission
 * 
 * Enables both the microphone input and AI audio output tracks.
 * Called when the user unmutes or starts a new conversation.
 */
async function startAudioTransmission() {
  // Ensure microphone is sending
  try {
    // If muted, do nothing (preserve user intent)
    if (isPaused) return true;
    if (!pc) {
      console.error("Peer connection not available");
    }
    // If we don't have a sender yet, try to find or create one
    if (!audioSender && pc && typeof pc.getSenders === 'function') {
      audioSender = pc.getSenders().find(s => s.track && s.track.kind === 'audio') || null;
    }
    // If sender has no track or we don't have a current track, reacquire mic and attach
    if (!audioTrack || (audioSender && !audioSender.track)) {
      const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioTrack = ms.getTracks()[0];
      if (audioSender && typeof audioSender.replaceTrack === 'function') {
        await audioSender.replaceTrack(audioTrack);
      } else if (pc) {
        audioSender = pc.addTrack(audioTrack);
      }
    } else {
      // Re-enable the existing track
      audioTrack.enabled = true;
    }
  } catch (e) {
    console.error("Failed to enable microphone", e);
  }

  // Unmute AI output
  if (audioEl && audioEl.srcObject) {
    const audioTracks = audioEl.srcObject.getAudioTracks();
    audioTracks.forEach(track => track.enabled = true);
    try { audioEl.muted = false; } catch (_) {}
  } else {
    console.error("AI audio output not available");
  }
}

/* 
 * Function to send response.cancel event
 * 
 * Sends a cancel event to the OpenAI API to interrupt the model's
 * current speech. This is used when the user mutes the audio or
 * wants to interrupt the AI's response.
 * 
 * @returns {boolean} - True if cancel event was sent, false otherwise
 */
function sendResponseCancel() {
  if (dc && dc.readyState === "open") {
    /* 
     * Check if there's an active response by checking if audio is playing
     * and if we have an active response ID 
     */
    // console.log("sendResponseCancel called, activeResponseId:", window.activeResponseId);

    if (window.activeResponseId) {
      const cancelEvent = {
        type: "response.cancel"
      };
      dc.send(JSON.stringify(cancelEvent));
      // console.log("Sent response.cancel event to interrupt model's speech");
      return true;
    } else {
      // console.log("No active response ID found - skipping cancel event");
      return false;
    }
  } else {
    console.error("Data channel is not open");
    return false;
  }
}

/* 
 * Function to check if there's an active response
 * 
 * Determines if the AI is currently speaking by checking
 * the audio element's state.
 * 
 * @returns {boolean} - True if AI is speaking, false otherwise
 */
function hasActiveResponse() {
  /* Check if audio is currently playing */
  const isPlaying = audioEl && audioEl.srcObject && !audioEl.paused;
  // console.log("hasActiveResponse check:", {
  //   audioEl: !!audioEl,
  //   srcObject: !!(audioEl && audioEl.srcObject),
  //   notPaused: !!(audioEl && !audioEl.paused),
  //   isPlaying: isPlaying
  // });
  return isPlaying;
}

/* 
 * Function to stop the LLM from generating more content
 * 
 * Sends a stop event to the OpenAI API to completely halt
 * the language model's generation process. This is more
 * aggressive than just canceling the current response.
 * 
 * @returns {boolean} - True if stop event was sent, false otherwise
 */
function stopLLMGeneration() {
  if (dc && dc.readyState === "open") {
    const stopEvent = {
      type: "stop"
    };
    dcSendJSONSafe(stopEvent);
    return true;
  }
  return false;
}

/* 
 * Function to stop audio transmission
 * 
 * Disables both the microphone input and AI audio output tracks.
 * Also stops the waveform animation.
 * 
 * @returns {Promise} - Resolves when audio transmission is stopped
 */
async function stopAudioTransmission() {
  try {
    // Detach mic from sender so no audio is sent to the peer
    if (audioSender && typeof audioSender.replaceTrack === 'function') {
      await audioSender.replaceTrack(null);
    }
    // Disable and stop the local mic track to fully release input
    if (audioTrack) {
      try { audioTrack.stop(); } catch (_) {}
      audioTrack.enabled = false;
    }

    // Mute AI output (speaker)
    if (audioEl && audioEl.srcObject) {
      const audioTracks = audioEl.srcObject.getAudioTracks();
      audioTracks.forEach(track => track.enabled = false);
      try { audioEl.muted = true; } catch (_) {}
    }

    // Stop waveform animation
    stopWaveform();
    return true;
  } catch (e) {
    console.warn('stopAudioTransmission error', e);
    return false;
  }
}

/* 
 * Function to cleanup WebRTC connection
 * 
 * Closes the data channel and peer connection,
 * and resets the active response ID.
 * Called when reinitializing the connection or
 * when the application is closed.
 */
function cleanupWebRTC() {
  // Defensive flush so Realtime transcripts aren’t lost
  try { if (Array.isArray(sessionHistory) && sessionHistory.length > 0) saveSession({ history: true }); } catch (_) {}
  /* Clear active response ID when cleaning up */
  window.activeResponseId = null;
  currentSessionConfig = null;
  defaultResponseModalities = [...DEFAULT_MODALITIES];
  // Reset Realtime init state so re-adding Voice can request again
  __rtState = 'idle';
  // Force history to be re-preloaded on next connect
  try { delete window.__historyPreloadedFor; } catch (_) {}

  // Stop audio level monitoring interval
  if (audioLevelInterval) {
    try { clearInterval(audioLevelInterval); } catch (_) {}
    audioLevelInterval = null;
  }

  if (dc) {
    dc.close();
    dc = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }

  // Stop and release microphone resources
  if (audioTrack) {
    try { audioTrack.stop(); } catch (_) {}
    audioTrack = null;
  }
  audioSender = null;
}

/* 
 * Function to initialize the canvas for waveform visualization
 * 
 * Sets up the canvas element and its context, and adds a resize
 * event listener to ensure the canvas always fills the window.
 */
function initializeCanvas() {
  canvas = document.getElementById('waveform');
  if (!canvas) return;
  ctx = canvas.getContext('2d');

  const rtBody = canvas.closest('.rt-body') || canvas.parentElement;

  function resizeToContainer() {
    if (!rtBody) return;
    const rect = rtBody.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  }

  // Disconnect previous observer if any
  if (waveformResizeObserver) {
    try { waveformResizeObserver.disconnect(); } catch (_) { }
  }

  resizeToContainer();
  waveformResizeObserver = new ResizeObserver(resizeToContainer);
  waveformResizeObserver.observe(rtBody);
}

/* 
 * Function to draw the audio waveform visualization
 * 
 * Takes audio data and renders it as a waveform on the canvas.
 * 
 * @param {Uint8Array} dataArray - Audio data from the analyzer
 */
function drawWaveform(dataArray) {
  if (!ctx) return;

  /* Clear the canvas with white background */
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  /* Set up line style for the waveform */
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--waveform-color');
  ctx.beginPath();

  const bufferLength = dataArray.length;
  const sliceWidth = (canvas.width * 1.0) / bufferLength;
  let x = 0;

  /* Draw the waveform line */
  for (let i = 0; i < bufferLength; i++) {
    const v = dataArray[i] / 128.0;
    const y = (v * canvas.height) / 2;

    if (i === 0) {
      ctx.moveTo(x, y);
    } else {
      ctx.lineTo(x, y);
    }

    x += sliceWidth;
  }

  ctx.lineTo(canvas.width, canvas.height / 2);
  ctx.stroke();
}

/* 
 * Function to start the waveform animation
 * 
 * Begins the animation loop that continuously samples audio data
 * and updates the waveform visualization.
 */
function startWaveform() {
  if (!animationId && audioAnalyser) {
    function draw() {
      animationId = requestAnimationFrame(draw);
      const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
      audioAnalyser.getByteTimeDomainData(dataArray);
      drawWaveform(dataArray);
    }
    draw();
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
  // Use a single console.log to keep it easy to copy
  console.log(text);
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
  console.log(out);
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
  if (!window.FileMaker?.PerformScript) return false;
  const options = (opts && typeof opts === 'object') ? opts : {};
  const payload = { sessionId: window.__sessionId || "" };
  if (options.settings) {
    payload.settings = buildSessionSettingsBundle();
  }
  if (options.history) {
    payload.history = Array.isArray(sessionHistory) ? sessionHistory.slice() : [];
  }
  try {
    window.FileMaker.PerformScript('Session_SaveState', JSON.stringify(payload));
    return true;
  } catch (e) {
    console.warn('Session_SaveState failed', e);
    return false;
  }
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
    voice: !!realtimeWidgetEl,
    text: !!textWidgetEl,
    toasts: !!toastsWidgetEl,
    showToolCalls: !!showToolPills,
    layout: nodes
  };
}

/**
 * Build a unified settings bundle for this session:
 * - Shared toggles (voice/text/toasts/float/showToolCalls)
 * - Layout per mode: { docked: [...], undocked: [...] }
 */
function buildSessionSettingsBundle() {
  const toggles = getCurrentToggleSettings();
  const base = {
    version: 1,
    columns: grid?.engine?.column || grid?.opts?.column || 12,
    cellHeight: undefined,
    float: !!floatEnabled,
    voice: !!toggles.voice,
    text: !!toggles.text,
    toasts: !!toggles.toasts,
    showToolCalls: !!toggles.showToolCalls
  };

  const currentSnapshot = computeCurrentSettingsSnapshot();
  const currentMode = getCurrentMode();

  const dockedLayout = Array.isArray(persistedSettings.docked?.layout)
    ? persistedSettings.docked.layout
    : (currentMode === 'docked' ? (currentSnapshot?.layout || []) : []);

  const undockedLayout = Array.isArray(persistedSettings.undocked?.layout)
    ? persistedSettings.undocked.layout
    : (currentMode === 'undocked' ? (currentSnapshot?.layout || []) : []);

  return {
    ...base,
    layout: {
      docked: dockedLayout,
      undocked: undockedLayout
    }
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
        source: item.metadata?.api ?? item.metadata?.source ?? null,
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
    voice: !!realtimeWidgetEl,
    text: !!textWidgetEl,
    toasts: !!toastsWidgetEl,
    layout: []
  };

  // Build settings without embedding layout
  const settings = {
    version: currentSettings.version || 1,
    columns: currentSettings.columns || 12,
    float: !!currentSettings.float,
    voice: !!currentSettings.voice,
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
  console.log(text);
  return text;
}

/**
 * Build minimal Realtime preload events from canonical history (no response.create).
 * Tool calls/results are injected as plain assistant text to avoid priming live tool state.
 */
function buildHistoryEvents(items) {
  const evs = [];

  for (const m of items || []) {
    if (!m) continue;

    if (m.type === 'message') {
      const role = m.role === 'assistant' ? 'assistant' : (m.role === 'user' ? 'user' : null);
      if (!role || !m.content) continue;
      evs.push({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role,
          content: [{ type: role === 'user' ? 'input_text' : 'text', text: m.content }]
        }
      });
      continue;
    }

    if (m.type === 'tool_call') {
      const name = m?.metadata?.tool?.name || 'unknown';
      const args = m?.metadata?.tool?.arguments ?? null;
      const argsStr = safeStr(args);
      evs.push({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'text',
            text: `Context only (do not re-execute): assistant previously requested tool "${name}" with arguments ${argsStr}`
          }]
        }
      });
      continue;
    }

    if (m.type === 'tool_result') {
      const callId = m?.metadata?.call_id || 'n/a';
      const status = m?.metadata?.status ?? 'success';
      const outStr = safeStr(m?.content);
      evs.push({
        type: 'conversation.item.create',
        item: {
          type: 'message',
          role: 'assistant',
          content: [{
            type: 'text',
            text: `Context only (do not re-execute): tool_result for call_id=${callId} (status=${status}) → ${outStr}`
          }]
        }
      });
      continue;
    }
  }
  return evs;
}

/**
 * Send canonical history into the Realtime session after channel opens.
 * Does not trigger a response (no response.create sent here).
 */
async function preloadHistoryIntoRealtime(items) {
  if (!dc || dc.readyState !== 'open') return false;
  const sid = window.__sessionId || 'unknown';
  if (window.__historyPreloadedFor === sid) return true;
  const evs = buildHistoryEvents(items);
  for (const ev of evs) {
    dcSendJSONSafe(normalizeConversationCreateEvent(ev));
    await new Promise(r => setTimeout(r, 5));
  }
  window.__historyPreloadedFor = sid;
  return true;
}

/**
 * Ask FileMaker for an ephemeral token/model when Voice widget mounts.
 * FileMaker should call back: window.applyRealtimeInit({ success, result:{ ... } })
 */
let __rtState = 'idle';
function ensureRealtimeReady() {
  if (__rtState === 'requesting' || __rtState === 'connecting' || __rtState === 'ready') return;

  if (window.FileMaker?.PerformScript) {
    __rtState = 'requesting';
    try {
      window.FileMaker.PerformScript('Realtime_Init', JSON.stringify({
        sessionId: window.__sessionId || ""
      }));
    } catch (e) {
      console.warn('Failed to call Realtime_Init', e);
      __rtState = 'idle';
    }
  } else {
    // Suppress early logs until after bootstrap has run; then log once if FM is unavailable
    if (!window.__bootstrapDone) {
      __rtState = 'idle';
      return;
    }
    if (!window.__rtInitNoticeShown) {
      console.log('FileMaker not available; call applyRealtimeInit(...) manually.');
      window.__rtInitNoticeShown = true;
    }
    __rtState = 'idle';
  }
}

/**
 * FM callback to start Realtime with provided params, then preload history.
 */
function applyRealtimeInit(payload) {
  try {
    const raw = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
    const data = (raw && typeof raw === 'object' && Object.prototype.hasOwnProperty.call(raw, 'success'))
      ? (raw.success ? (raw.result || {}) : null)
      : raw;

    if (!data) {
      console.error('applyRealtimeInit: invalid payload or success=false', raw);
      __rtState = 'idle';
      return false;
    }

    const {
      ephemeralKey, token, model,
      instructions = 'You are a helpful AI assistant.',
      tools = '[]', toolChoice = 'auto',
      sessionConfig = '{}'
    } = data;

    const key = ephemeralKey || token;
    if (!key || !model) {
      console.error('applyRealtimeInit: missing ephemeralKey/token or model');
      __rtState = 'idle';
      return false;
    }

    __rtState = 'connecting';
    initializeWebRTC(
      key,
      model,
      instructions,
      typeof tools === 'string' ? tools : JSON.stringify(tools),
      toolChoice,
      typeof sessionConfig === 'string' ? sessionConfig : JSON.stringify(sessionConfig)
    );
    return true;
  } catch (e) {
    console.error('applyRealtimeInit failed', e);
    __rtState = 'idle';
    return false;
  }
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
    const mode = data.key || data.mode || 'docked';

    // Seed sessions list (sidebar and undocked widget)
    if (Array.isArray(data.sessions)) {
      setSessionList(data.sessions);
    }

    // Seed history: preserve tool_call/tool_result; buffer only message items for legacy UI
    if (Array.isArray(data.history)) {
      const incoming = [];
      const bufferMsgs = [];
      for (const m of data.history) {
        const ts = (m && typeof m.ts === 'number') ? m.ts : Date.now();

        // Canonical tool_call
        if (m && m.type === 'tool_call') {
          incoming.push({
            id: createId('tc'),
            ts,
            role: 'tool',
            type: 'tool_call',
            content: null,
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
            id: createId('tr'),
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
          id: createId('m'),
          ts,
          role,
          type: 'message',
          content: text,
          metadata: { source: m?.metadata?.source ?? m?.source ?? null }
        });

        if (text) {
          bufferMsgs.push({
            role,
            text,
            ts,
            source: m?.metadata?.source ?? m?.source ?? null
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
    // Accept top-level layout {docked:[], undocked:[]} or legacy settings.layout
    const layoutObj = (data.layout && typeof data.layout === 'object' && !Array.isArray(data.layout))
      ? data.layout
      : (s.layout && typeof s.layout === 'object' && !Array.isArray(s.layout) ? s.layout : null);

    if (layoutObj) {
      ['docked', 'undocked'].forEach((k) => {
        const arr = layoutObj[k];
        if (Array.isArray(arr)) {
          const prev = persistedSettings[k] || {};
          persistedSettings[k] = {
            version: s.version || prev.version || 1,
            columns: s.columns || prev.columns || 12,
            cellHeight: s.cellHeight !== undefined ? s.cellHeight : prev.cellHeight,
            float: (s.float !== undefined) ? !!s.float : !!prev.float,
            voice: (s.voice !== undefined) ? !!s.voice : !!prev.voice,
            text: (s.text !== undefined) ? !!s.text : !!prev.text,
            toasts,
            showToolCalls: (typeof s.showToolCalls === 'boolean') ? !!s.showToolCalls : prev.showToolCalls,
            layout: arr
          };
          try {
            localStorage.setItem(`settings:${k}`, JSON.stringify({ key: k, settings: persistedSettings[k] }));
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
        const applied = applySettingsForMode(mode);
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
 * Send typed text into Realtime if connected; otherwise, hand off to FileMaker (placeholder).
 * @param {string} text
 * @param {boolean} requestResponse
 * @param {string[]|string} modalitiesOverride
 * @returns {boolean}
 */
function sendTextToRealtime(text, requestResponse = true, modalitiesOverride = null) {
  const trimmed = (text || '').trim();
  if (!trimmed) return false;

  if (dc && dc.readyState === 'open') {
    const conversationEvent = {
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: trimmed }]
      }
    };
    try {
      dcSendJSONSafe(normalizeConversationCreateEvent(conversationEvent));
      enableToolsIfDisabled();

      if (requestResponse) {
        const normalizedModalitiesOverride = normalizeModalitiesList(modalitiesOverride) || modalitiesOverride;
        const modalities = getResponseModalities(normalizedModalitiesOverride);
        const responseCreateEvent = {
          type: 'response.create',
          response: { modalities }
        };
        try {
          dcSendJSONSafe(responseCreateEvent);
        } catch (e2) {
          console.warn("Failed to send response.create over data channel", e2);
        }
      }

      // mirror in UI
      appendChatMessage('user', trimmed, { source: 'typed' });
      return true;
    } catch (e) {
      console.warn("Data channel send failed; falling back to FileMaker", e);
      // fall through to FM fallback
    }
  }

  // Fallback: ask FileMaker to route text via its agent selection
  if (window.FileMaker) {
    try { saveSession({ history: true }); } catch (_) {}
    try {
      window.FileMaker.PerformScript('Chat_TextRequest', JSON.stringify({
        sessionId: window.__sessionId || "",
        message: trimmed
      }));
      appendChatMessage('user', trimmed, { source: 'typed' });
      return true;
    } catch (e) {
      console.warn('Chat_TextRequest script not available', e);
    }
  }

  showToast('Realtime not connected and text mode not available.', 'tool-error', 'left', null, 5);
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

  sendTextToRealtime(value, true);
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
  if (!files || files.length === 0) return;
  try {
    const list = Array.from(files);
    // Mirror a single summary message in UI
    const summary = list.length === 1
      ? (promptFromInput ? `${promptFromInput} [image shared]` : '[image shared]')
      : (promptFromInput ? `${promptFromInput} [${list.length} images shared]` : `[${list.length} images shared]`);
    appendChatMessage('user', summary, { source: 'typed' });

    // Send images sequentially; attach prompt only on first; request response only after last
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      const dataUrl = await readFileAsDataUrl(file);
      const mimeType = file.type || undefined;
      const isLast = (i === list.length - 1);
      await sendContainerImageToRealtime({
        dataUrl,
        mimeType,
        prompt: i === 0 ? promptFromInput : '' // include prompt only for the first image
      }, isLast);
    }
  } catch (e) {
    console.error('Failed to read image(s) for upload', e);
    showToast('Failed to attach image(s).', 'tool-error', 'left', null, 5);
  }
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

      if (window.FileMaker) {
        try {
          window.FileMaker.PerformScript("ShowJSON", jsonString);
        } catch (error) {
          console.error('Error calling FileMaker script:', error);
        }
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
 * Function to stop the waveform animation
 * 
 * Cancels the animation frame, clears the canvas,
 * and shows the ear icon if not paused.
 */
function stopWaveform() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
    if (ctx) {
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    const earIcon = document.getElementById('earIcon');
    if (earIcon && !isPaused) {
      earIcon.style.display = 'block';
    }
  }
}


/* 
 * WebRTC and audio processing variables
 * 
 * pc: RTCPeerConnection for WebRTC
 * dc: Data channel for sending/receiving events
 * isPaused: Flag indicating if audio transmission is paused
 * audioTrack: The microphone audio track
 * audioEl: Audio element for playing AI responses
 * audioContext: Web Audio API context
 * audioAnalyser: Analyser node for processing audio data
 * audioDataArray: Buffer for audio data
 */
let pc = null;
let dc = null;
let isPaused = false;
let audioTrack = null;
let audioSender = null;
let audioEl = null;
let audioContext = null;
let audioAnalyser = null;
let audioDataArray = null;
let audioLevelInterval = null;

/* 
 * Function to initialize the audio analyzer
 * 
 * Creates an audio context and analyzer for processing
 * audio data to visualize the waveform and detect activity.
 */
function initAudioAnalyser() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioAnalyser = audioContext.createAnalyser();
    audioAnalyser.fftSize = 256;
    audioDataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
  }
}

/* 
 * Function to check for audio activity
 * 
 * Analyzes the audio data to determine if there's meaningful
 * audio input. If there is, shows the waveform; otherwise,
 * shows the ear icon.
 * 
 * @returns {boolean} - True if audio activity is detected, false otherwise
 */
function checkAudioActivity() {
  if (audioAnalyser && !isPaused) {
    audioAnalyser.getByteFrequencyData(audioDataArray);
    const average = audioDataArray.reduce((a, b) => a + b) / audioDataArray.length;

    /* Use a threshold to determine if there's meaningful audio */
    const AUDIO_THRESHOLD = 10; /* Adjust this value based on testing */
    const hasAudio = average > AUDIO_THRESHOLD;
    const iconOverlay = document.getElementById('iconOverlay');

    if (hasAudio && !isPaused) {
      startWaveform();
      iconOverlay.style.display = 'none';
    } else {
      stopWaveform();
      if (!isPaused) {
        iconOverlay.style.display = 'flex';
        showIcon('ear');
      }
    }

    return hasAudio;
  }
  return false;
}

/* 
 * Function to toggle audio transmission on/off
 * 
 * Handles the mute/unmute functionality when the user clicks
 * the interface. When pausing, it stops audio transmission and
 * cancels any active response. When resuming, it either restarts
 * the existing connection or reinitializes WebRTC if needed.
 */
async function toggleAudioTransmission() {
  // console.log('Toggle clicked. Current isPaused:', isPaused);
  isPaused = !isPaused;
  // console.log('New isPaused state:', isPaused);

  const iconOverlay = document.getElementById('iconOverlay');
  // console.log('Icon overlay display:', iconOverlay.style.display);

  if (isPaused) {
    // console.log('Pausing audio transmission');
    await stopAudioTransmission();

    /* Only attempt to cancel if we have an active response ID */
    // console.log('Checking for active response before canceling, activeResponseId:', window.activeResponseId);
    if (window.activeResponseId) {
      sendResponseCancel();
    }

    showIcon('sleep');
  } else {
    // console.log('Resuming audio transmission');
    if (!dc || dc.readyState !== "open") {
      // console.log("Data channel not ready, reinitializing WebRTC");
      /* Reset the paused state since we're reinitializing */
      isPaused = false;
      showIcon('ear');
      cleanupWebRTC(); /* Clean up old connection */
      /* Trigger reinitialization from FileMaker */
      if (window.FileMaker) {
        /* This needs to be looked at this script should not be used */
        //window.FileMaker.PerformScript("SendToOpenAI", "");
      }
    } else {
      await startAudioTransmission();
      showIcon('ear');
    }
  }
}

/* 
 * UI settings control from FileMaker or URL
 * Pass JSON like: {"voice":true, "text":false, "toasts":true}
 */
function setUISettings(updateParamsJson) {
  try {
    const settings = typeof updateParamsJson === 'string' ? JSON.parse(updateParamsJson) : (updateParamsJson || {});
    const voice = settings.voice ?? settings.realtime ?? settings.audio;
    const text = settings.text ?? settings.chat;
    const convos = settings.convos ?? settings.conversations ?? settings.sidebar;
    const toasts = settings.toasts ?? settings.debug_toasts ?? settings.debug;

    const btnVoice = document.getElementById('btn-voice');
    const btnText = document.getElementById('btn-text');
    const btnToasts = document.getElementById('btn-toasts');

    if (btnVoice && voice !== undefined) {
      setPressed(btnVoice, !!voice);
    }
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
    if (typeof syncWidgets === 'function') {
      syncWidgets();
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
    const nodes = (grid.engine?.nodes || []).map(n => ({
      widget: n.el?.dataset?.widget || null,
      x: n.x, y: n.y, w: n.w, h: n.h
    }));
    const key = isConvosDocked ? 'docked' : 'undocked';

    // Snapshot current toggles by widget presence
    const settingsSnapshot = {
      version: 1,
      columns: grid.engine?.column || grid.opts?.column || 12,
      // Note: cellHeight not currently dynamic; include if you expose it
      float: !!floatEnabled,
      voice: !!realtimeWidgetEl,
      text: !!textWidgetEl,
      toasts: !!toastsWidgetEl,
      showToolCalls: !!showToolPills,
      layout: nodes
    };

    // Cache in-memory and localStorage for this mode
    persistedSettings[key] = settingsSnapshot;
    try {
      localStorage.setItem(`settings:${key}`, JSON.stringify({
        key,
        settings: settingsSnapshot
      }));
    } catch (_) { }

    // Send to FileMaker (user-scoped default; FileMaker derives user via Get( Username ))
    const envelope = {
      key,
      sessionId: window.__sessionId || null,
      settings: settingsSnapshot
    };
    if (window.FileMaker) {
      window.FileMaker.PerformScript('Grid_SaveLayout', JSON.stringify(envelope));
    } else {
      console.log('Layout envelope:', envelope);
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
      window.FileMaker.PerformScript('Grid_RestoreDefaultLayout', JSON.stringify(payload));
      return true;
    }
    // Fallback: local default behavior
    dockConvos();
    const nodes = [...(grid.engine?.nodes || [])];
    nodes.forEach(n => { if (n?.el) grid.removeWidget(n.el); });
    const btnVoice = document.getElementById('btn-voice');
    const btnText = document.getElementById('btn-text');
    const btnToasts = document.getElementById('btn-toasts');
    if (btnVoice) { btnVoice.classList.add('active'); btnVoice.setAttribute('aria-pressed', 'true'); }
    if (btnText) { btnText.classList.remove('active'); btnText.setAttribute('aria-pressed', 'false'); }
    if (btnToasts) { btnToasts.classList.add('active'); btnToasts.setAttribute('aria-pressed', 'true'); }
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
      window.FileMaker.PerformScript('Grid_LoadLayout', JSON.stringify(payload));
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

  // Respect float setting
  if (typeof payload.float === 'boolean' && typeof grid.float === 'function') {
    floatEnabled = payload.float;
    grid.float(floatEnabled);
  }

  // Conversations docked state is determined by the current mode key; no adjustment here.

  // Remove all existing widgets
  const existing = [...(grid.engine?.nodes || [])];
  existing.forEach(n => n?.el && grid.removeWidget(n.el));
  realtimeWidgetEl = null;
  toastsWidgetEl = null;
  textWidgetEl = null;
  convosWidgetEl = null;

  // Rebuild widgets from layout data (respect current toggle states)
  const toggles = getCurrentToggleSettings();
  const includeVoice = !!toggles.voice;
  const includeText = !!toggles.text;
  const includeToasts = !!toggles.toasts;

  // Rebuild via dispatcher
  const flags = { includeVoice, includeText, includeToasts };
  payload.layout.forEach(n => {
    addWidgetByType(n.widget, { x: n.x, y: n.y, w: n.w, h: n.h }, flags);
  });

  // Ensure Conversations widget appears when undocked even if omitted
  if (!isConvosDocked && !convosWidgetEl) {
    const saved = getSavedWidgetRect('convo', getCurrentMode());
    window.__addConversationsWidget && window.__addConversationsWidget(saved || DEFAULT_POS.convo);
  }

  // Update menu button states to reflect presence
  const btnVoice = document.getElementById('btn-voice');
  const btnText = document.getElementById('btn-text');
  const btnToasts = document.getElementById('btn-toasts');
  if (btnVoice) {
    const on = !!realtimeWidgetEl;
    btnVoice.classList.toggle('active', on);
    btnVoice.setAttribute('aria-pressed', String(on));
  }
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
}

// Helpers to apply settings/layouts from FileMaker and persist preferences
function applySettingsEnvelope(envelope) {
  const env = typeof envelope === 'string' ? parseJsonSafely(envelope, 'settings envelope') : (envelope || {});
  if (!env) return false;

  const S = env.settings || {};
  // Accept layout at top-level (preferred) or legacy settings.layout
  const L = (env.layout && typeof env.layout === 'object' && !Array.isArray(env.layout))
    ? env.layout
    : (S.layout && typeof S.layout === 'object' && !Array.isArray(S.layout) ? S.layout : null);

  if (!L) return false;

  ['docked', 'undocked'].forEach((k) => {
    const arr = L[k];
    if (Array.isArray(arr)) {
      const prev = persistedSettings[k] || {};
      const toasts = (S.toasts !== undefined) ? !!S.toasts : (prev.toasts ?? !!S.debug);
      persistedSettings[k] = {
        version: S.version || prev.version || 1,
        columns: S.columns || prev.columns || 12,
        cellHeight: S.cellHeight !== undefined ? S.cellHeight : prev.cellHeight,
        float: (S.float !== undefined) ? !!S.float : !!prev.float,
        voice: (S.voice !== undefined) ? !!S.voice : !!prev.voice,
        text: (S.text !== undefined) ? !!S.text : !!prev.text,
        toasts,
        showToolCalls: (typeof S.showToolCalls === 'boolean') ? !!S.showToolCalls : prev.showToolCalls,
        layout: arr
      };
      try {
        localStorage.setItem(`settings:${k}`, JSON.stringify({ key: k, settings: persistedSettings[k] }));
      } catch (_) {}
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

  if (obj.settings || obj.key || (obj.layout && typeof obj.layout === 'object' && !Array.isArray(obj.layout))) {
    return applySettingsEnvelope(obj);
  }
  if (Array.isArray(obj.layout)) {
    applyLayout(obj);
    return true;
  }
  return false;
}

function getCurrentToggleSettings() {
  const btnVoice = document.getElementById('btn-voice');
  const btnText = document.getElementById('btn-text');
  const btnToasts = document.getElementById('btn-toasts');
  const btnToolCalls = document.getElementById('btn-tool-calls');
  const mode = getCurrentMode();
  return {
    voice: !!btnVoice?.classList.contains('active'),
    text: !!btnText?.classList.contains('active'),
    toasts: !!btnToasts?.classList.contains('active'),
    showToolCalls: !!btnToolCalls?.classList.contains('active'),
    float: !!floatEnabled,
    mode
  };
}

function savePreferences() {
  if (!prefsReady || applyingFromFM) return;
  // Save only settings into the unified session JSON
  saveSession({ settings: true });
}



/* 
 * Initialize the application when the DOM is fully loaded
 * 
 * Bootstraps GridStack and mounts the Realtime / Toasts / Text widgets based on toggles.
 */
document.addEventListener("DOMContentLoaded", () => {
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
  const btnVoice = document.getElementById('btn-voice');
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
      resizable: { handles: 'e,se,s,sw,w' }
    },
    '#appGrid'
  );

  // Persist layout changes on drag/resize stop (and generic 'change')
  function __handleGridNodesChanged(evt, movedNodes) {
    if (applyingFromFM) return;
    const mode = getCurrentMode();
    const nodes = Array.isArray(movedNodes) ? movedNodes : (evt && Array.isArray(evt.nodes) ? evt.nodes : []);
    if (!nodes || nodes.length === 0) return;
    let touched = false;
    try {
      nodes.forEach(n => {
        const w = n?.el?.dataset?.widget;
        if (!w) return;
        updateSavedWidgetRect(w, { x: n.x, y: n.y, w: n.w, h: n.h }, mode);
        touched = true;
      });
    } catch (_) {}
    if (touched) {
      // Save updated settings snapshot to the current session
      saveSession({ settings: true });
    }
  }
  try {
    grid.on('dragstop', __handleGridNodesChanged);
    grid.on('resizestop', __handleGridNodesChanged);
    grid.on('change', __handleGridNodesChanged);
  } catch (_) {}

  function addRealtimeWidget(pos) {
    if (realtimeWidgetEl) return;
    const mode = getCurrentMode();
    const saved = !pos ? getSavedWidgetRect('voice', mode) : null;
    const p = pos || saved || DEFAULT_POS.voice;
    const el = grid.addWidget({ x: p.x, y: p.y, w: p.w, h: p.h });
    const contentEl = el.querySelector('.grid-stack-item-content') || el;
    contentEl.innerHTML = `
        <div class="realtime-widget">
          <div class="gs-handle">Voice</div>
          <div class="rt-body">
            <canvas id="waveform"></canvas>
            <div id="clickOverlay"></div>
            <div id="iconOverlay"></div>
          </div>
        </div>`;
    realtimeWidgetEl = el;
    el.dataset.widget = 'voice';
    // Cache position and presence for this mode
    updateSavedWidgetRect('voice', p, mode);
    ensureModeSettings(mode); 
    persistedSettings[mode].voice = true;
    persistModeSettings(mode);
    // Hook up canvas and click handlers inside the widget
    initializeCanvas();
    const clickOverlay = document.getElementById('clickOverlay');
    if (clickOverlay) {
      clickOverlay.addEventListener('click', toggleAudioTransmission);
    }
    showIcon(isPaused ? 'sleep' : 'ear');
    // Ask FM for ephemeral token/model; then boot Realtime and preload history
    ensureRealtimeReady();
  }

  function removeRealtimeWidget() {
    if (!realtimeWidgetEl) return;
    const mode = getCurrentMode();
    const node = realtimeWidgetEl.gridstackNode || (grid.engine?.nodes || []).find(n => n.el === realtimeWidgetEl);
    if (node) {
      updateSavedWidgetRect('voice', { x: node.x, y: node.y, w: node.w, h: node.h }, mode);
    }
    grid.removeWidget(realtimeWidgetEl);
    realtimeWidgetEl = null;
    if (waveformResizeObserver) {
      try { waveformResizeObserver.disconnect(); } catch (_) { }
      waveformResizeObserver = null;
    }
    // Clear audio level monitoring interval
    if (audioLevelInterval) {
      try { clearInterval(audioLevelInterval); } catch (_) {}
      audioLevelInterval = null;
    }
    ensureModeSettings(mode);
    persistedSettings[mode].voice = false;
    persistModeSettings(mode);
    // Flush canonical history before tearing down voice, then cleanup Realtime
    try { saveSession({ history: true }); } catch (_) {}
    cleanupWebRTC();
  }

  function addToastsWidget(pos) {
    if (toastsWidgetEl) return;
    const mode = getCurrentMode();
    const saved = !pos ? getSavedWidgetRect('toasts', mode) : null;
    const p = pos || saved || DEFAULT_POS.toasts;
    const el = grid.addWidget({ x: p.x, y: p.y, w: p.w, h: p.h });
    const contentEl = el.querySelector('.grid-stack-item-content') || el;
    contentEl.innerHTML = `
        <div class="toasts-widget">
          <div class="gs-handle">Activity</div>
          <div class="toast-timeline" id="toast-timeline"></div>
        </div>`;
    toastsWidgetEl = el;
    el.dataset.widget = 'toasts';
    // Cache position and presence for this mode
    updateSavedWidgetRect('toasts', p, mode);
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
    const p = pos || saved || DEFAULT_POS.convo;
    const el = grid.addWidget({ x: p.x, y: p.y, w: p.w, h: p.h });
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
    updateSavedWidgetRect('convo', p, mode);
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
    const p = pos || saved || DEFAULT_POS.text;
    const el = grid.addWidget({ x: p.x, y: p.y, w: p.w, h: p.h });
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
    updateSavedWidgetRect('text', p, mode);
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
    const voiceOn = document.getElementById('btn-voice')?.classList.contains('active');
    const textOn = document.getElementById('btn-text')?.classList.contains('active');
    const toastsOn = document.getElementById('btn-toasts')?.classList.contains('active');

    if (voiceOn) addRealtimeWidget(); else removeRealtimeWidget();
    if (textOn) addTextWidget(); else removeTextWidget();
    if (toastsOn) addToastsWidget(); else removeToastsWidget();
    // Conversations docking is controlled by the anchor buttons
  }

  // Expose grid/widget helpers for global calls
  window.__addRealtimeWidget = addRealtimeWidget;
  window.__removeRealtimeWidget = removeRealtimeWidget;
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
  btnVoice?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !btnVoice.classList.contains('active');
    setPressed(btnVoice, on);
    syncWidgets();
    savePreferences();
  });
  btnText?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !btnText.classList.contains('active');
    setPressed(btnText, on);
    syncWidgets();
    savePreferences();
  });
  btnToasts?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !btnToasts.classList.contains('active');
    setPressed(btnToasts, on);
    syncWidgets();
    savePreferences();
  });
  // Show Tool Calls toggle
  btnToolCalls?.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !btnToolCalls.classList.contains('active');
    setPressed(btnToolCalls, on);
    showToolPills = on;
    renderChatFromHistory();
    savePreferences();
  });

  // Copy Test Payload button
  btnCopyMinified?.addEventListener('click', (e) => {
    e.stopPropagation();
    copyMinifiedHistory();
  });

  // Float toggle
  btnToggleFloat?.addEventListener('click', (e) => {
    e.stopPropagation();
    floatEnabled = !floatEnabled;
    if (typeof grid.float === 'function') {
      grid.float(floatEnabled);
    } else {
      // fallback: update option (may not reflow immediately in older versions)
      grid?.opts && (grid.opts.float = floatEnabled);
    }
    btnToggleFloat.textContent = floatEnabled ? 'Float On' : 'Float Off';
    savePreferences();
  });

  // Save/Restore
  btnSaveLayout?.addEventListener('click', (e) => { e.stopPropagation(); saveCurrentLayout(); });
  btnRestoreLayout?.addEventListener('click', (e) => { e.stopPropagation(); restoreDefaultLayout(); });

  document.getElementById('dock-convos-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
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
  // Try to apply cached settings for selected mode; fallback to defaults
  if (!applySettingsForMode(bootMode)) {
    if (!loadLayoutForCurrentMode()) {
      syncWidgets();
    }
  }
  prefsReady = true;
});

/* 
 * Function to initialize the WebRTC connection with OpenAI
 * 
 * Sets up the peer connection, data channel, and audio tracks
 * for real-time communication with the OpenAI API.
 * 
 * @param {string} ephemeralKey - OpenAI API key
 * @param {string} model - The model to use (e.g., "gpt-4o")
 * @param {string} instructions - System instructions for the AI
 * @param {string} toolsStr - JSON string of available tools
 * @param {string} toolChoice - Tool selection strategy
 * @returns {RTCPeerConnection} - The established peer connection
 */
async function initializeWebRTC(ephemeralKey, model, instructions, toolsStr, toolChoice, sessionConfig) {
  /* Initialize activeResponseId tracking */
  window.activeResponseId = null;

  try {
    const preparedConfig = prepareSessionConfiguration(instructions, toolsStr, toolChoice, sessionConfig);
    const resolvedSessionConfig = preparedConfig.sessionConfig;
    defaultResponseModalities = Array.isArray(preparedConfig.defaultModalities) && preparedConfig.defaultModalities.length > 0
      ? [...preparedConfig.defaultModalities]
      : [...DEFAULT_MODALITIES];
    currentSessionConfig = resolvedSessionConfig;

    pc = new RTCPeerConnection();

    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = e => {
      audioEl.muted = !!isPaused;
      audioEl.srcObject = e.streams[0];
      // Get the audio tracks from the stream
      const audioTracks = audioEl.srcObject.getAudioTracks();
      if (isPaused) {
        audioTracks.forEach(track => track.enabled = false);
      }

      // Set up audio analysis
      initAudioAnalyser();
      const source = audioContext.createMediaStreamSource(e.streams[0]);
      source.connect(audioAnalyser);

      // Start monitoring audio levels
      if (audioLevelInterval) { clearInterval(audioLevelInterval); }
      audioLevelInterval = setInterval(checkAudioActivity, 100);
    };

    const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioTrack = ms.getTracks()[0];
    // If currently muted, keep the mic track disabled on init
    try { audioTrack.enabled = !isPaused; } catch (_) {}
    audioSender = pc.addTrack(audioTrack);

    dc = pc.createDataChannel("oai-events");
    try { dc.bufferedAmountLowThreshold = 65536; } catch (_) {}
    // Reset state if channel closes later (allows re-init on re-add)
    dc.addEventListener("close", () => { __rtState = 'idle'; try { delete window.__historyPreloadedFor; } catch (_) {} });
    dc.addEventListener("error", (e) => { console.warn("Data channel error", e); showToast("Data channel error; try toggling Voice off/on.", "tool-error", "left", null, 6); });
    dc.addEventListener("open", () => {
      // Mark Realtime as ready after channel opens
      __rtState = 'ready';
      const sessionUpdateEvent = {
        type: "session.update",
        session: resolvedSessionConfig
      };
      dcSendJSONSafe(sessionUpdateEvent);

      // Preload canonical history without triggering a response
      if (Array.isArray(sessionHistory) && sessionHistory.length > 0) {
        preloadHistoryIntoRealtime(sessionHistory).catch(() => {});
      }

      // Respect current mute state across session changes
      if (!isPaused) {
        startAudioTransmission();
      } else {
        // Keep output muted if user had muted
        try {
          if (audioEl && audioEl.srcObject) {
            audioEl.srcObject.getAudioTracks().forEach(t => t.enabled = false);
          }
        } catch (_) {}
        try { if (audioEl) audioEl.muted = true; } catch (_) {}
        showIcon('sleep');
      }
    });

    dc.addEventListener("message", async (e) => {
      // Realtime server events appear here!
      const realtimeEvent = JSON.parse(e.data);
      // console.log(`[${new Date().toISOString()}] Type:`, realtimeEvent.type);
      // console.log(`[${new Date().toISOString()}] Event:`, realtimeEvent);

      // Track response state for debugging
      if (realtimeEvent.type === "response.created") {
        // console.log("Response created, setting activeResponseId:", realtimeEvent.response.id);
        window.activeResponseId = realtimeEvent.response.id;
      } else if (realtimeEvent.type === "response.done") {
        // console.log("Response done, clearing activeResponseId");
        window.activeResponseId = null;
      }

      if (realtimeEvent.type === "response.done" && realtimeEvent.response.output?.some(item => item.type === "function_call")) {
        const toolCalls = realtimeEvent.response.output.filter(item => item.type === "function_call");

        showToast("Assistant requested tools", "tool-call", "right", JSON.stringify({ toolCalls }), 8);

        if (window.FileMaker) {
          showIcon('thought');

          // Clear any pending timeouts
          if (window.earIconTimeout) {
            clearTimeout(window.earIconTimeout);
            delete window.earIconTimeout;
          }

          // Call FileMaker script once
          window.FileMaker.PerformScript("CallTools", JSON.stringify({ 'toolCalls': toolCalls }));
        }

        // Append tool_call items to canonical history
        try {
          for (const call of toolCalls) {
            const name = call?.name || call?.tool_name || 'unknown';
            let args = null;
            if (call && call.arguments !== undefined) {
              if (typeof call.arguments === 'string') {
                try { args = JSON.parse(call.arguments); } catch (_) { args = call.arguments; }
              } else {
                args = call.arguments;
              }
            }
            const responseId = realtimeEvent.response?.id || null;
            const call_id = call?.call_id || call?.id || null;
            appendToolCall(name, args, call_id, responseId);
          }
          // If Text widget is mounted and tool pills are enabled, re-render to show pills
          if (showToolPills) {
            renderChatFromHistory();
          }
        } catch (_) {}
      }

      // Only handle response.done if it's not a function call
      if (realtimeEvent.type === "response.done") {
        // Check for error status
        if (realtimeEvent.response.status === "failed") {
          console.error("Response failed with status details:", realtimeEvent.response.status_details);

          if (realtimeEvent.response.status_details?.error) {
            const errorCode = realtimeEvent.response.status_details.error.code;
            const errorMessage = realtimeEvent.response.status_details.error.message;
            const errorType = realtimeEvent.response.status_details.error.type;

            console.error("Error code:", errorCode);
            console.error("Error message:", errorMessage);
            console.error("Error type:", errorType);

            // Handle insufficient_quota error specifically
            if (errorCode === "insufficient_quota") {
              // Show the complete error message without truncation
              showErrorMessage(errorMessage);

              // Notify FileMaker if available
              if (window.FileMaker) {
                window.FileMaker.PerformScript("HandleAPIError", JSON.stringify({
                  code: errorCode,
                  message: errorMessage,
                  type: errorType
                }));
              }
            }
          }
        }

        // Handle normal completion (no function call)
        if (!realtimeEvent.response.output?.some(item => item.type === "function_call")) {
          if (!isPaused) {
            // Set timeout to show ear icon after 500ms
            setTimeout(() => {
              if (!isPaused) {
                showIcon('ear');
              }
            }, 500);
          }
        }

        // Only try to access output if it exists and has elements
        if (realtimeEvent.response.output && realtimeEvent.response.output.length > 0) {
          const transcript = realtimeEvent.response.output[0].content?.[0]?.transcript;
          if (transcript) {
            appendChatMessage('assistant', transcript, { source: 'realtime' });
          }
        }
        // If a recent image was uploaded, log a concise result from the model's output
        if (window.__lastImageSendAt && Date.now() - window.__lastImageSendAt < 15000) {
          try {
            const out = realtimeEvent.response.output || [];
            let resultText = null;
            for (const it of out) {
              const parts = Array.isArray(it.content) ? it.content : [];
              for (const part of parts) {
                if (typeof part?.text === 'string' && part.text) { resultText = part.text; break; }
                if (typeof part?.transcript === 'string' && part.transcript) { resultText = part.transcript; break; }
              }
              if (resultText) break;
            }
            if (resultText) {
              console.log('Image response:', resultText);
            } else {
              console.log('Image response: (no text content returned)');
            }
          } catch (_) {}
          window.__lastImageSendAt = 0;
        }
      }

      if (realtimeEvent.type === "conversation.item.input_audio_transcription.completed") {
        // Check if we have a transcript in the expected location
        const transcript = realtimeEvent.item?.content?.transcript || realtimeEvent.transcript || '';
        if (transcript) {
          enableToolsIfDisabled();
          appendChatMessage('user', transcript, { source: 'realtime' });
        }
      }



      if (realtimeEvent.type === "error" ||
        realtimeEvent.type === "conversation.stopped") {
        showIcon('ear');
      }

      if (realtimeEvent.type === "error") {
        console.error("Error event received:", realtimeEvent.error);
      }


      if (realtimeEvent.tool_calls) {
        for (const tool of realtimeEvent.tool_calls) {
          if (tool.name === "get_current_datetime") {
            const toolResponse = {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: tool.call_id,
                output: {
                  current_datetime: new Date().toISOString()
                }
              }
            };

            // Send tool response back to OpenAI
            dcSendJSONSafe(toolResponse);

            // After sending the tool response, request the model to generate a response
            const responseCreateEvent = {
              type: "response.create",
              response: {
                modalities: ["text"]
              }
            };
            dcSendJSONSafe(responseCreateEvent);
          }
        }
      }
    });

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const baseUrl = "https://api.openai.com/v1/realtime";
    const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp"
      },
    });

    if (!sdpResponse.ok) {
      if (sdpResponse.status === 429) {
        showErrorMessage("Rate limit error encountered. Please try again later.");
      }
      throw new Error(`SDP response error! status: ${sdpResponse.status}`);
    }

    const answer = {
      type: "answer",
      sdp: await sdpResponse.text(),
    };
    await pc.setRemoteDescription(answer);
    /* TODO: Change the UI from loading to showing the logo */
    return pc;
  } catch (error) {
    console.error("Failed to initialize WebRTC:", error);
    alert("Failed to initialize WebRTC. Please try again.");
  }
}
