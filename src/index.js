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

/* Rebuild grid from a layout array (+ float), respecting current dock state for convo */
function rebuildFromLayout(layout = [], float = floatEnabled) {
  if (!grid) return;

  if (typeof float === 'boolean' && typeof grid.float === 'function') {
    floatEnabled = float;
    grid.float(floatEnabled);
  }

  // Remove all existing widgets
  const existing = [...(grid.engine?.nodes || [])];
  existing.forEach(n => n?.el && grid.removeWidget(n.el));
  realtimeWidgetEl = null;
  toastsWidgetEl = null;
  textWidgetEl = null;
  convosWidgetEl = null;

  // Add widgets back based on layout
  layout.forEach(n => {
    switch (n.widget) {
      case 'voice':
        window.__addRealtimeWidget && window.__addRealtimeWidget({ x: n.x, y: n.y, w: n.w, h: n.h });
        break;
      case 'toasts':
        window.__addToastsWidget && window.__addToastsWidget({ x: n.x, y: n.y, w: n.w, h: n.h });
        break;
      case 'text':
        window.__addTextWidget && window.__addTextWidget({ x: n.x, y: n.y, w: n.w, h: n.h });
        break;
      case 'convo':
        if (!isConvosDocked) {
          window.__addConversationsWidget && window.__addConversationsWidget({ x: n.x, y: n.y, w: n.w, h: n.h });
        }
        break;
      default:
        break;
    }
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
  if (btnVoice) {
    btnVoice.classList.toggle('active', !!settings.voice);
    btnVoice.setAttribute('aria-pressed', String(!!settings.voice));
  }
  if (btnText) {
    btnText.classList.toggle('active', !!settings.text);
    btnText.setAttribute('aria-pressed', String(!!settings.text));
  }
  if (btnToasts) {
    btnToasts.classList.toggle('active', !!settings.toasts);
    btnToasts.setAttribute('aria-pressed', String(!!settings.toasts));
  }

  rebuildFromLayout(settings.layout, settings.float);
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

const DEFAULT_MODALITIES = ["text", "audio"];
const DEFAULT_CONTAINER_IMAGE_TOOL = Object.freeze({
  type: "function",
  name: "request_container_image",
  description: "Request the latest image stored in the FileMaker container field so the assistant can use it as visual context.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "Optional guidance for the user about the kind of image that should be provided."
      }
    }
  }
});

let defaultResponseModalities = [...DEFAULT_MODALITIES];
let containerImageToolName = DEFAULT_CONTAINER_IMAGE_TOOL.name;
let currentSessionConfig = null;

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

function prepareSessionConfiguration(instructions, toolsStr, toolChoice, sessionConfigStr) {
  let tools = [];

  const parsedTools = parseJsonSafely(toolsStr, 'tools');
  if (Array.isArray(parsedTools)) {
    tools = parsedTools;
  }

  const additionalConfig = parseJsonSafely(sessionConfigStr, 'session configuration') || {};

  let disableContainerImageTool = false;
  if (typeof additionalConfig.disableDefaultContainerImageTool !== 'undefined') {
    disableContainerImageTool = Boolean(additionalConfig.disableDefaultContainerImageTool);
    delete additionalConfig.disableDefaultContainerImageTool;
  } else if (typeof additionalConfig.disable_container_image_tool !== 'undefined') {
    disableContainerImageTool = Boolean(additionalConfig.disable_container_image_tool);
    delete additionalConfig.disable_container_image_tool;
  }

  let containerImageToolDefinition = null;
  if (additionalConfig.containerImageTool && typeof additionalConfig.containerImageTool === 'object') {
    containerImageToolDefinition = additionalConfig.containerImageTool;
    delete additionalConfig.containerImageTool;
  } else if (additionalConfig.container_image_tool && typeof additionalConfig.container_image_tool === 'object') {
    containerImageToolDefinition = additionalConfig.container_image_tool;
    delete additionalConfig.container_image_tool;
  }

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

  const imageTool = containerImageToolDefinition
    ? JSON.parse(JSON.stringify(containerImageToolDefinition))
    : JSON.parse(JSON.stringify(DEFAULT_CONTAINER_IMAGE_TOOL));
  if (!disableContainerImageTool) {
    const existingNames = new Set(tools.map(tool => tool && tool.name));
    if (!existingNames.has(imageTool.name)) {
      tools.push(imageTool);
    }
  }

  const defaultSessionConfig = {
    instructions: instructions || "You are a helpful AI assistant.",
    tools,
    tool_choice: toolChoice || "auto",
    input_audio_transcription: {
      model: "gpt-4o-mini-transcribe"
    },
    modalities: [...DEFAULT_MODALITIES],
    voice: "verse"
  };

  const sessionConfig = deepMerge(defaultSessionConfig, additionalConfig);

  if (!Array.isArray(sessionConfig.modalities) || sessionConfig.modalities.length === 0) {
    sessionConfig.modalities = [...DEFAULT_MODALITIES];
  }

  sessionConfig.tools = Array.isArray(sessionConfig.tools) ? sessionConfig.tools : [];

  const defaultModalities = Array.isArray(defaultModalitiesOverride) && defaultModalitiesOverride.length > 0
    ? defaultModalitiesOverride
    : sessionConfig.modalities;

  return {
    sessionConfig,
    defaultModalities,
    containerToolName: imageTool.name
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

function sendContainerImageToRealtime(imagePayload, requestResponse = true) {
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
    image_base64: normalized.base64Data
  };

  if (normalized.mimeType) {
    imageContent.mime_type = normalized.mimeType;
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

  dc.send(JSON.stringify(conversationEvent));

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
    dc.send(JSON.stringify(responseCreateEvent));
  }

  if (window.FileMaker) {
    try {
      window.FileMaker.PerformScript("LogMessage", JSON.stringify({
        role: "user",
        message: promptText ? `${promptText} [image shared]` : "[image shared]"
      }));
    } catch (error) {
      console.warn("Failed to log image message to FileMaker:", error);
    }
  }

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

    console.log("Preparing to send response:", response);
    console.log("Response stringified:", JSON.stringify(response));

    dc.send(JSON.stringify(response));
    console.log("Sent tool response");
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
    dc.send(JSON.stringify(responseCreateEvent));
    console.log("Requested new model response");
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

    let disableContainerImageTool = false;
    if (typeof parsedUpdate.disableDefaultContainerImageTool !== 'undefined') {
      disableContainerImageTool = Boolean(parsedUpdate.disableDefaultContainerImageTool);
      delete parsedUpdate.disableDefaultContainerImageTool;
    } else if (typeof parsedUpdate.disable_container_image_tool !== 'undefined') {
      disableContainerImageTool = Boolean(parsedUpdate.disable_container_image_tool);
      delete parsedUpdate.disable_container_image_tool;
    }

    let containerImageToolDefinition = null;
    if (parsedUpdate.containerImageTool && typeof parsedUpdate.containerImageTool === 'object') {
      containerImageToolDefinition = parsedUpdate.containerImageTool;
      delete parsedUpdate.containerImageTool;
    } else if (parsedUpdate.container_image_tool && typeof parsedUpdate.container_image_tool === 'object') {
      containerImageToolDefinition = parsedUpdate.container_image_tool;
      delete parsedUpdate.container_image_tool;
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

    if (Array.isArray(updateParams.tools)) {
      if (containerImageToolDefinition && containerImageToolDefinition.name) {
        containerImageToolName = containerImageToolDefinition.name;
      }

      const containerToolFromConfig = containerImageToolDefinition
        || (currentSessionConfig?.tools || []).find(tool => tool && tool.name === containerImageToolName)
        || DEFAULT_CONTAINER_IMAGE_TOOL;

      const containerToolToUse = containerToolFromConfig && containerToolFromConfig.name
        ? JSON.parse(JSON.stringify(containerToolFromConfig))
        : null;

      const existingNames = new Set(updateParams.tools.map(tool => tool && tool.name));

      if (disableContainerImageTool) {
        updateParams.tools = updateParams.tools.filter(tool => tool && tool.name !== containerImageToolName);
      } else if (containerToolToUse && !existingNames.has(containerToolToUse.name)) {
        updateParams.tools.push(containerToolToUse);
      }
    }

    if (containerImageToolDefinition && Array.isArray(updateParams.tools)) {
      const index = updateParams.tools.findIndex(tool => tool && tool.name === containerImageToolName);
      if (index >= 0) {
        updateParams.tools[index] = JSON.parse(JSON.stringify(containerImageToolDefinition));
      }
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

    dc.send(JSON.stringify(sessionUpdateEvent));
    console.log("Sent session update:", updateParams);

    currentSessionConfig = deepMerge(currentSessionConfig || {}, updateParams);

    return true;
  } catch (error) {
    console.error("Failed to update session:", error);
    return false;
  }
}

/* 
 * Function to start audio transmission
 * 
 * Enables both the microphone input and AI audio output tracks.
 * Called when the user unmutes or starts a new conversation.
 */
function startAudioTransmission() {

  /* Unmute microphone input */
  if (audioTrack) {
    audioTrack.enabled = true;
  } else {
    console.error("Microphone track not available");
  }

  /* Unmute AI output */
  if (audioEl && audioEl.srcObject) {
    const audioTracks = audioEl.srcObject.getAudioTracks();
    audioTracks.forEach(track => track.enabled = true);
    // console.log("Unmuted AI output");
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
    dc.send(JSON.stringify(stopEvent));
    console.log("Sent stop event to cut off LLM output");
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
  return new Promise((resolve) => {
    /* Mute microphone input */
    if (audioTrack) {
      audioTrack.enabled = false;
      // console.log("Muted microphone input");
    }

    /* Mute AI output */
    if (audioEl && audioEl.srcObject) {
      const audioTracks = audioEl.srcObject.getAudioTracks();
      audioTracks.forEach(track => track.enabled = false);
      // console.log("Muted AI output");
    }

    /* Stop waveform animation */
    stopWaveform();

    resolve();
  });
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
  /* Clear active response ID when cleaning up */
  window.activeResponseId = null;
  currentSessionConfig = null;
  defaultResponseModalities = [...DEFAULT_MODALITIES];

  if (dc) {
    dc.close();
    dc = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
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
function renderChatMessage(role, text) {
  const list = document.getElementById('chat-messages');
  if (!list || !text) return;

  const row = document.createElement('div');
  row.className = `chat-message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  row.appendChild(bubble);
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
  renderChatMessage(role, text);
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

    // Seed chat history buffer first
    if (Array.isArray(data.history)) {
      chatBuffer.splice(
        0,
        chatBuffer.length,
        ...data.history.map(m => ({
          role: m && m.role ? m.role : 'system',
          text: m && typeof m.text === 'string' ? m.text : '',
          ts: m && typeof m.ts === 'number' ? m.ts : Date.now(),
          source: m && m.source ? m.source : null
        }))
      );
      // If Text widget is already mounted, render immediately
      const list = document.getElementById('chat-messages');
      if (list) {
        list.innerHTML = '';
        chatBuffer.forEach(m => renderChatMessage(m.role, m.text));
      }
    }

    // Cache per-mode settings (normalize debug -> toasts)
    const s = data.settings || {};
    const toasts = (s.toasts !== undefined) ? !!s.toasts : !!s.debug;
    if (Array.isArray(s.layout)) {
      persistedSettings[mode] = {
        version: s.version || 1,
        columns: s.columns || 12,
        cellHeight: s.cellHeight,
        float: !!s.float,
        voice: !!s.voice,
        text: !!s.text,
        toasts,
        layout: s.layout
      };
    }

    // Persist desired mode and session id for later application
    window.__bootstrapMode = mode;
    if (data.sessionId) {
      window.__sessionId = data.sessionId;
    }

    // If grid is already initialized, immediately align dock state and apply layout/toggles
    if (grid) {
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
    }

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
    dc.send(JSON.stringify(conversationEvent));

    if (requestResponse) {
      const normalizedModalitiesOverride = normalizeModalitiesList(modalitiesOverride) || modalitiesOverride;
      const modalities = getResponseModalities(normalizedModalitiesOverride);
      const responseCreateEvent = {
        type: 'response.create',
        response: { modalities }
      };
      dc.send(JSON.stringify(responseCreateEvent));
    }

    // mirror in UI
    appendChatMessage('user', trimmed, { source: 'typed' });
    return true;
  }

  // Fallback: try FileMaker text mode (if available)
  if (window.FileMaker) {
    try {
      window.FileMaker.PerformScript('Chat_SendMessage', JSON.stringify({ role: 'user', message: trimmed }));
      appendChatMessage('user', trimmed, { source: 'typed' });
      return true;
    } catch (e) {
      console.warn('Chat_SendMessage script not available', e);
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
    const file = files[0];
    const dataUrl = await readFileAsDataUrl(file);
    const mimeType = file.type || undefined;

    // Mirror in UI
    appendChatMessage('user', promptFromInput ? `${promptFromInput} [image shared]` : '[image shared]', { source: 'typed' });

    // Send to Realtime
    sendContainerImageToRealtime({ dataUrl, mimeType, prompt: promptFromInput }, true);
  } catch (e) {
    console.error('Failed to read image for upload', e);
    showToast('Failed to attach image.', 'tool-error', 'left', null, 5);
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
let audioEl = null;
let audioContext = null;
let audioAnalyser = null;
let audioDataArray = null;

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
      startAudioTransmission();
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
      btnVoice.classList.toggle('active', !!voice);
      btnVoice.setAttribute('aria-pressed', String(!!voice));
    }
    if (btnText && text !== undefined) {
      btnText.classList.toggle('active', !!text);
      btnText.setAttribute('aria-pressed', String(!!text));
    }
    if (btnToasts && toasts !== undefined) {
      btnToasts.classList.toggle('active', !!toasts);
      btnToasts.setAttribute('aria-pressed', String(!!toasts));
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
      scope: "user",
      key,
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
    dockConvos();
    // remove all widgets
    const nodes = [...(grid.engine?.nodes || [])];
    nodes.forEach(n => {
      if (n?.el) {
        grid.removeWidget(n.el);
      }
    });
    // Reset to defaults: Voice on, Toasts on, Text off
    const btnVoice = document.getElementById('btn-voice');
    const btnText = document.getElementById('btn-text');
    const btnToasts = document.getElementById('btn-toasts');
    if (btnVoice) { btnVoice.classList.add('active'); btnVoice.setAttribute('aria-pressed', 'true'); }
    if (btnText) { btnText.classList.remove('active'); btnText.setAttribute('aria-pressed', 'false'); }
    if (btnToasts) { btnToasts.classList.add('active'); btnToasts.setAttribute('aria-pressed', 'true'); }
    // Re-mount widgets
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
    // Use cached settings if available; else attempt localStorage
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

  // Rebuild widgets from layout data
  payload.layout.forEach(n => {
    switch (n.widget) {
      case 'voice':
        window.__addRealtimeWidget && window.__addRealtimeWidget({ x: n.x, y: n.y, w: n.w, h: n.h });
        break;
      case 'toasts':
        window.__addToastsWidget && window.__addToastsWidget({ x: n.x, y: n.y, w: n.w, h: n.h });
        break;
      case 'text':
        window.__addTextWidget && window.__addTextWidget({ x: n.x, y: n.y, w: n.w, h: n.h });
        break;
      case 'convo':
        if (!isConvosDocked) {
          window.__addConversationsWidget && window.__addConversationsWidget({ x: n.x, y: n.y, w: n.w, h: n.h });
        }
        break;
      default:
        break;
    }
  });

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

/* 
 * Initialize the application when the DOM is fully loaded
 * 
 * Bootstraps GridStack and mounts the Realtime / Toasts / Text widgets based on toggles.
 */
document.addEventListener("DOMContentLoaded", () => {
  const sidebarEl = document.querySelector('.sidebar');

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
  }

  // Hamburger menu elements
  const menuToggle = document.getElementById('menu-toggle');
  const menuPanel = document.getElementById('menu-panel');
  const btnVoice = document.getElementById('btn-voice');
  const btnText = document.getElementById('btn-text');
  const btnToasts = document.getElementById('btn-toasts');
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

  function addRealtimeWidget(pos) {
    if (realtimeWidgetEl) return;
    const el = grid.addWidget({ x: pos?.x ?? 0, y: pos?.y ?? 0, w: pos?.w ?? 4, h: pos?.h ?? 4 });
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
    // Hook up canvas and click handlers inside the widget
    initializeCanvas();
    const clickOverlay = document.getElementById('clickOverlay');
    if (clickOverlay) {
      clickOverlay.addEventListener('click', toggleAudioTransmission);
    }
    showIcon('ear');
  }

  function removeRealtimeWidget() {
    if (!realtimeWidgetEl) return;
    grid.removeWidget(realtimeWidgetEl);
    realtimeWidgetEl = null;
    if (waveformResizeObserver) {
      try { waveformResizeObserver.disconnect(); } catch (_) { }
      waveformResizeObserver = null;
    }
  }

  function addToastsWidget(pos) {
    if (toastsWidgetEl) return;
    const el = grid.addWidget({ x: pos?.x ?? 8, y: pos?.y ?? 0, w: pos?.w ?? 4, h: pos?.h ?? 6 });
    const contentEl = el.querySelector('.grid-stack-item-content') || el;
    contentEl.innerHTML = `
        <div class="toasts-widget">
          <div class="gs-handle">Activity</div>
          <div class="toast-timeline" id="toast-timeline"></div>
        </div>`;
    toastsWidgetEl = el;
    el.dataset.widget = 'toasts';
    // Prevent dragging from inside the timeline; only header should drag
    const timelineEl = contentEl.querySelector('.toast-timeline');
    if (timelineEl) {
      ['mousedown', 'touchstart', 'pointerdown'].forEach(evt => {
        timelineEl.addEventListener(evt, (e) => e.stopPropagation(), true);
      });
    }
  }

  function removeToastsWidget() {
    if (!toastsWidgetEl) return;
    grid.removeWidget(toastsWidgetEl);
    toastsWidgetEl = null;
  }

  function addConversationsWidget(pos) {
    if (convosWidgetEl) return;
    const el = grid.addWidget({ x: pos?.x ?? 0, y: pos?.y ?? 0, w: pos?.w ?? 3, h: pos?.h ?? 8 });
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
    // prevent drag from inner content
    const listEl = contentEl.querySelector('.conversation-list');
    const btnEl = contentEl.querySelector('.new-convo-btn');
    const searchEl = contentEl.querySelector('.conversation-search-input');
    const dockBtn = contentEl.querySelector('.dock-convos-widget-btn');
    ['mousedown', 'touchstart', 'pointerdown'].forEach(evt => {
      listEl?.addEventListener(evt, (e) => e.stopPropagation(), true);
      btnEl?.addEventListener(evt, (e) => e.stopPropagation(), true);
      searchEl?.addEventListener(evt, (e) => e.stopPropagation(), true);
      dockBtn?.addEventListener(evt, (e) => e.stopPropagation(), true);
    });
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
    }
    // wire search
    attachConversationSearch(searchEl, listEl);
  }

  function removeConversationsWidget() {
    if (!convosWidgetEl) return;
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
  }

  function addTextWidget(pos) {
    if (textWidgetEl) return;
    const el = grid.addWidget({ x: pos?.x ?? 0, y: pos?.y ?? 12, w: pos?.w ?? 12, h: pos?.h ?? 6 });
    const contentEl = el.querySelector('.grid-stack-item-content') || el;
    contentEl.innerHTML = `
        <div class="text-widget">
          <div class="gs-handle">Text Chat</div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input">
            <input type="file" id="chat-image-input" accept="image/*" style="display:none" />
            <button class="chat-btn" id="chat-image-btn" title="Attach image">📎</button>
            <textarea id="chat-input" rows="1" placeholder="Type a message..."></textarea>
            <button class="chat-btn primary" id="chat-send-btn">Send</button>
          </div>
        </div>`;
    textWidgetEl = el;
    el.dataset.widget = 'text';

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
      ['mousedown', 'touchstart', 'pointerdown'].forEach(evt => {
        inputEl.addEventListener(evt, (e) => e.stopPropagation(), true);
      });
    }
    if (messagesEl) {
      ['mousedown', 'touchstart', 'pointerdown'].forEach(evt => {
        messagesEl.addEventListener(evt, (e) => e.stopPropagation(), true);
      });
    }
    if (imageBtn && imageInput) {
      imageBtn.addEventListener('click', () => imageInput.click());
      imageInput.addEventListener('change', (e) => {
        handleChatImageUpload(e.target.files, inputEl ? inputEl.value.trim() : '');
        // do not clear input text automatically; user may want to keep it
        e.target.value = '';
      });
    }

    // Render any buffered chat history into the Text widget on mount
    if (Array.isArray(chatBuffer) && chatBuffer.length > 0) {
      chatBuffer.forEach(m => renderChatMessage(m.role, m.text));
    }
  }

  function removeTextWidget() {
    if (!textWidgetEl) return;
    grid.removeWidget(textWidgetEl);
    textWidgetEl = null;
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
    btnVoice.classList.toggle('active');
    btnVoice.setAttribute('aria-pressed', String(btnVoice.classList.contains('active')));
    syncWidgets();
  });
  btnText?.addEventListener('click', (e) => {
    e.stopPropagation();
    btnText.classList.toggle('active');
    btnText.setAttribute('aria-pressed', String(btnText.classList.contains('active')));
    syncWidgets();
  });
  btnToasts?.addEventListener('click', (e) => {
    e.stopPropagation();
    btnToasts.classList.toggle('active');
    btnToasts.setAttribute('aria-pressed', String(btnToasts.classList.contains('active')));
    syncWidgets();
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
  });

  // Save/Restore
  btnSaveLayout?.addEventListener('click', (e) => { e.stopPropagation(); saveCurrentLayout(); });
  btnRestoreLayout?.addEventListener('click', (e) => { e.stopPropagation(); restoreDefaultLayout(); });

  document.getElementById('dock-convos-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isConvosDocked) undockConvos(); else dockConvos();
  });

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
async function initializeWebRTC(ephemeralKey, model, instructions, toolsStr, toolChoice, sessionConfigStr) {
  /* Initialize activeResponseId tracking */
  window.activeResponseId = null;

  try {
    const preparedConfig = prepareSessionConfiguration(instructions, toolsStr, toolChoice, sessionConfigStr);
    const sessionConfig = preparedConfig.sessionConfig;
    defaultResponseModalities = Array.isArray(preparedConfig.defaultModalities) && preparedConfig.defaultModalities.length > 0
      ? [...preparedConfig.defaultModalities]
      : [...DEFAULT_MODALITIES];
    containerImageToolName = preparedConfig.containerToolName || DEFAULT_CONTAINER_IMAGE_TOOL.name;
    currentSessionConfig = sessionConfig;

    pc = new RTCPeerConnection();

    audioEl = document.createElement("audio");
    audioEl.autoplay = true;
    pc.ontrack = e => {
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
      setInterval(checkAudioActivity, 100);
    };

    const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
    audioTrack = ms.getTracks()[0];
    pc.addTrack(audioTrack);

    dc = pc.createDataChannel("oai-events");
    dc.addEventListener("open", () => {
      const sessionUpdateEvent = {
        type: "session.update",
        session: sessionConfig
      };
      dc.send(JSON.stringify(sessionUpdateEvent));
      startAudioTransmission();
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
        console.log("Model tool calls:", toolCalls);

        if (toolCalls.some(call => call.name === containerImageToolName)) {
          showToast("Assistant requested an image from FileMaker", "tool-call", "right", JSON.stringify({ toolCalls }), 8);
        }

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
          console.log("Model response:", realtimeEvent.response.output[0]);
          const transcript = realtimeEvent.response.output[0].content?.[0]?.transcript;
          if (window.FileMaker && transcript) {
            window.FileMaker.PerformScript("LogMessage", JSON.stringify({
              role: "assistant",
              message: transcript
            }));
          }
          if (transcript) {
            appendChatMessage('assistant', transcript, { source: 'realtime' });
          }
        } else {
          console.log("Model response: No output available");
        }
      }

      if (realtimeEvent.type === "conversation.item.input_audio_transcription.completed") {
        // Check if we have a transcript in the expected location
        const transcript = realtimeEvent.item?.content?.transcript || realtimeEvent.transcript || '';
        if (transcript) {
          console.log("User message:", transcript);
          if (window.FileMaker) {
            window.FileMaker.PerformScript("LogMessage", JSON.stringify({
              role: "user",
              message: transcript
            }));
          }
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
            dc.send(JSON.stringify(toolResponse));


            // After sending the tool response, request the model to generate a response
            const responseCreateEvent = {
              type: "response.create",
              response: {
                modalities: ["text"]
              }
            };
            dc.send(JSON.stringify(responseCreateEvent));
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
