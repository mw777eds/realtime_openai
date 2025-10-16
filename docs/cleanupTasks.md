# Cleanup Tasks for src/index.js Reorganization

Use this checklist to perform safe, incremental refactors. Keep behavior identical after each step and test before proceeding.

## Incremental Steps (execute in order)
- [x] Step 1: Introduce FileMaker wrapper and centralized script-name constants (no behavior change).
- [x] Step 2: Add audio level interval management (create audioLevelInterval; clear it in cleanupWebRTC and removeRealtimeWidget).
- [x] Step 3: Extract tiny DOM helpers: setPressed(btn, on) and stopDragFrom(el) to reduce repetition.
- [x] Step 4: Consolidate widget add/remove dispatch into small dispatcher maps (voice/toasts/text/convo) to replace repeated switch statements.
- [x] Step 5: Centralize default widget rects (DEFAULT_POS) used by add*Widget functions.
- [ ] Step 6: Reorder functions by module sections (utilities → FM bridge → sessions → history → text chat → toasts → grid/layout → realtime → bootstrap) without changing any logic.
- [ ] Step 6a: Move initializeWebRTC above DOMContentLoaded so DOMContentLoaded is last.
- [x] Step 6b: Remove redundant applySettingsForMode call during init to avoid double rebuild.
- [x] Step 7: Extract safeStr and readFileAsDataUrl into Utilities section (pure helpers only).
- [x] Step 8: Normalize save/build settings paths to use a single function for current settings bundle where possible (no behavior change).
- [x] Step 9: Final tidy: replace repeated PerformScript calls with callFM where appropriate.

## Detailed To-Do by Area

### Utilities
- [x] Add helper: setPressed(btn, on) to toggle .active + aria-pressed.
- [x] Add helper: stopDragFrom(el) to stopPropagation for pointer events.
- [x] Extract safeStr(v, max) used in buildHistoryEvents.
- [x] Keep parseJsonSafely, deepMerge, normalizeModalitiesList, normalizeImagePayload, createId, trimHistory grouped together.
- [x] Keep readFileAsDataUrl here.

### FileMaker Bridge
- [x] Add callFM(name, payload) wrapper (stringify payload if object; try/catch).
- [x] Add FM constants: { SaveState, GetState, GridSave, GridLoad, GridRestore, RealtimeInit, ChatText, CallTools, HandleAPIError, LogMessage, ShowJSON }.
- [x] Replace direct PerformScript calls gradually with callFM (in sendTextToRealtime fallback, Grid save/load, HandleAPIError, tool calls, etc.).

### Sessions and Sidebar
- [x] Keep setSessionList, renderSessionList, highlightActiveSession, switchSession together.
- [x] Ensure switchSession flushes via saveSession({ history:true, settings:true }) before requesting next state.

### Canonical History and Rendering
- [x] Keep appendCanonicalMessage, appendToolCall, appendToolResult together.
- [x] Keep buildMinifiedHistoryFromSession near them.
- [x] Keep renderChatFromHistory and renderToolPill collocated and using showToolPills flag.

### Text Chat
- [x] Keep recordChatMessage, renderChatMessage, appendChatMessage, chatHistoryToText, logChatHistory, getChatBuffer, logChatBufferRaw grouped.
- [x] Verify sendTextToRealtime fallback passes { sessionId, prompt } (current code already does).
- [x] Keep handleChatSend and handleChatImageUpload together.

### Toasts
- [x] Keep createToastTimeline, showToast, dismissToast grouped.

### Grid/Layout and Settings
- [x] Keep loadPersistedSettings, ensureModeSettings, persistModeSettings, getSavedWidgetRect, updateSavedWidgetRect together.
- [x] Keep computeCurrentSettingsSnapshot and buildSessionSettingsBundle together.
- [x] Keep getCurrentToggleSettings and savePreferences together.
- [x] Consolidate rebuildFromLayout/applyLayout/applySettingsForMode to use dispatcher maps.
- [x] Keep saveCurrentLayout, restoreDefaultLayout, loadLayoutForCurrentMode together.
- [x] Keep dockConvos/undockConvos and Conversations widget add/remove in this area.

### Realtime/WebRTC
- [x] Keep prepareSessionConfiguration, getResponseModalities, enableToolsIfDisabled together.
- [x] Manage audio level interval:
  - Create: let audioLevelInterval = null (module scope).
  - Set in ontrack: audioLevelInterval = setInterval(checkAudioActivity, 100).
  - Clear in cleanupWebRTC() and removeRealtimeWidget().
- [x] Keep initializeCanvas/drawWaveform/startWaveform/stopWaveform with waveformResizeObserver handling.
- [x] Keep sendToolResponse, createModelResponse, updateSession together.
- [x] Keep sendResponseCancel, hasActiveResponse, stopLLMGeneration grouped.
- [x] Keep ensureRealtimeReady and applyRealtimeInit together.
- [x] Keep buildHistoryEvents and preloadHistoryIntoRealtime together.
- [x] Ensure cleanupWebRTC resets defaults and clears intervals; stop and null audioTrack.

### Bootstrap and Wiring
- [ ] Keep bootstrapApp near bottom but above DOMContentLoaded wiring.
- [ ] Keep DOMContentLoaded handler last to wire grid init, widgets, menu, and mount according to persisted/boot settings.
- [ ] Keep pagehide handler to flush history.

## Gotchas and Warnings (do not break these)
- Keep function declarations (not const/arrow) so hoisting preserves call sites above definitions.
- Keep top-level window API exports available immediately (do NOT move inside DOMContentLoaded).
- Do not move DOMContentLoaded above function definitions.
- Reset __rtState to 'idle' during cleanup and when the data channel closes; set to 'ready' on channel open so re-adding the Voice widget can reinitialize Realtime.
- Clear window.__historyPreloadedFor on cleanup and on data channel close so canonical history is preloaded on every reconnect.
- ensureRealtimeReady must be defined before addRealtimeWidget uses it (hoisting via declarations is okay).
- applyRealtimeInit and initializeWebRTC must remain callable by FileMaker as soon as the viewer evaluates the script.
- Clear audio level interval (setInterval in ontrack) during cleanup; otherwise memory/timer leaks.
- When consolidating rebuild/apply layout logic, preserve conditions for isConvosDocked so Conversations widget only appears when undocked.
- Maintain prompt property in Chat_TextRequest fallback payload (do not revert to message).
- Preserve persistedSettings shape and localStorage keys: settings:docked and settings:undocked.
- FileMaker can call JS before modules evaluate; keep inline stubs in index.html to buffer bootstrapApp/applySessionState/applyRealtimeInit and drain pending payloads in DOMContentLoaded.

## Quick Tests After Each Step
- [ ] Text send while Realtime disconnected triggers Chat_TextRequest with { prompt } and renders user bubble.
- [ ] Realtime start still preloads history; speaking shows waveform; muting cancels response and shows sleep icon.
- [ ] Toggling Voice/Text/Toasts adds/removes widgets and persists positions in localStorage.
- [ ] Dock/Undock toggles sidebar/widget correctly and preserves layout per mode.
- [ ] Tool calls render tool pills when enabled; JSON modal opens and closes.
- [ ] No console errors on reload; apply bootstrap payload still renders sessions and history.
