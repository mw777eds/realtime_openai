FileMaker AI Chat + Realtime API Unified Interface — Revised Requirements

1. Scope and goals
- Single, unified chat UI that works with both:
  - OpenAI Realtime API (voice + data channel).
  - Chat Completions API (text-first).
- One canonical source of truth for history stored in FileMaker (per sessionId).
- Realtime and Text modes can run concurrently:
  - While Realtime is active, the text chat remains usable and mirrors the same conversation stream (user + assistant).
  - Any typed text, uploaded image, or approved widget interaction during Realtime is appended to the canonical log and immediately sent into the Realtime session.
- When starting Realtime: preload model state from the canonical log.
- When stopping Realtime: the next text submission uses the updated canonical log with everything captured during Realtime.

2. Current system (baseline)
- Realtime API working (voice I/O, streaming responses).
- Chat Completions scripting working (tool calls supported).
- Logging:
  - Realtime → history already logged; extend to include tool_call and tool_result consistently.
  - Chat Completions → integrate into the same canonical log structure.

3. Grid container (GridStack)
- Library: GridStack v10+ (bundle gridstack-all.js + gridstack.min.css).
- Grid options (initial):
  - column: 12, oneColumnModeDomSort: true, cellHeight: 8 with cellHeightUnit: 'px', margin: 6.
  - float: true.
  - draggable: { handle: '.gs-handle', scroll: true }, resizable: { handles: 'e, se, s, sw, w' }.
- Persistence:
  - Maintain two saved layouts per user and mode: Docked (sidebar visible) and Undocked (Conversations as a widget). Saved under AccountName (and optionally sessionId if you prefer per-chat layouts).
  - Save Layout sends an envelope: { key, sessionId, settings { version, columns, cellHeight?, float, voice, text, toasts|debug, showToolCalls?, layout: { docked: [...], undocked: [...] } } }. If only the current mode’s array is provided, FileMaker merges it into the stored layout object by key.
    - When the user clicks Save Layout in the menu, it updates the per-user defaults (used to seed new sessions and for Restore Default).
    - Session state is saved separately under sessionId when you choose (e.g., via saveSessionState on pagehide); do not overwrite user defaults unless Save Layout is clicked.
    - There is no scope parameter; scripts determine the target: Save Layout updates user defaults, Session_SaveState persists the session’s conversation. Grid_LoadLayout should prefer session state for the current key, else fall back to user defaults.
  - Restore loads the envelope for the current mode and applies settings (float and toggles) and settings.layout to rebuild widgets. If none is saved, defaults are applied and users can arrange, then Save Layout.
  - Front-end caching: on load, fetch both “docked” and “undocked” settings once and cache them in-memory; docking/undocking applies the cached settings immediately without a round-trip. Save Layout updates both FileMaker and the in-memory cache for the current mode.
  - Client gating and precedence: the web app tags cached settings with __source ('session'|'machine') and __sessionId. applyLoadedLayout ignores machine/default envelopes once a session-scoped layout for the current session is present. Grid_LoadLayout responses should include sessionId when returning session state so the client can distinguish sources.
  - Debug logging: the app logs MD5s for layouts/settings on upload and load: [Grid_LoadLayout] Request/Fallback, [applySettingsEnvelope]/[applyLoadedLayout], [applySettingsForMode]/[rebuildFromLayout], [Grid_SaveLayout], [Session_SaveState]. Use these to verify round-trips and precedence in FileMaker.
- Widgets:
  - Chat Widget (unified): renders canonical history; shows streaming rows; nests tool calls/results; markdown rendering.
  - Voice Widget: mic toggle, connection state (listening/thinking/speaking), device indicators.
  - Conversations Widget: optional; mirrors the left sidebar list. Dock/undock via the anchor button in the sidebar: when undocked, the fixed sidebar hides and the Conversations widget can be positioned/resized by the user.
  - Artifact Widgets: created programmatically when tools return artifacts; persisted and linked to parent message/artifact id.
- Not needed: palette/spawner or external drag-in (no GridStack.setupDragIn). Artifacts are added programmatically by the app based on tool results. Nice-to-have: allow re-import of artifacts from a FileMaker window back into GridStack via a scripted action.
- Trash bin: optional fixed drop zone (.trash-bin). On remove → call FM to delete the widget record; confirm if unsaved state exists.
- Events to wire: added, change, removed, dragstart/dragstop, resizestart/resizestop. Persist on change/removed.
- Accessibility: aria roles; focus/keyboard re-ordering.

4. Canonical history model (FileMaker JSON)
Each item is append-only. Realtime is the authority while active; all modes read/write this same model.

{
  "id": "uuid",
  "sessionId": "string",
  "role": "user|assistant|tool|system",
  "type": "message|tool_call|tool_result|artifact",
  "content": "string|null",
  "timestamp": "ISO-8601",
  "metadata": {
    "api": "realtime|chat_completions",
    "streaming": true|false,
    "responseId": "string|null",
    "parentId": "string|null",
    "modalities": ["text","audio","image"]|null,
    "tool": {
      "name": "string|null",
      "arguments": "object|null",
      "status": "pending|success|error|null",
      "durationMs": "number|null",
      "error": {"code":"string","message":"string"}|null
    },
    "summary": false
  },
  "artifacts": [
    {
      "id": "uuid",
      "type": "image|file|html|viz|custom",
      "title": "string|null",
      "uri": "string|null",
      "dataUrl": "string|null",
      "mimeType": "string|null",
      "extra": "object|null"
    }
  ]
}

- FM scripts:
  - Realtime_Init(sessionId) → return ephemeral key + model/session config for Realtime; FM selects the agent/config (JS does not pass agent).
  - Chat_TextRequest(sessionId; JSON { prompt }) → wrapper that selects the agent in FileMaker, loads history via Session_GetState, calls CallAgent internally, and persists updates via Session_SaveState.
  - CallAgent(sessionId; JSON { agentName, message }) → invoked by Chat_TextRequest; continues the chat and persists updates.
  - Session_SaveState(sessionId; JSON) → upsert unified session JSON; merge provided keys (settings/history).
  - Session_GetState(sessionId) → return unified session JSON.
  - Grid_SaveLayout(sessionId; JSON) / Grid_LoadLayout(sessionId).
  - CallTools(sessionId; JSON toolCalls[]) → execute model tool calls and return outputs to the web viewer.
  - HandleAPIError(JSON).

5. Synchronization rules
- Realtime is the source of truth while active.
- Realtime start:
  - Load canonical via Session_GetState(sessionId), then use result.history.
  - Preload into Realtime by sending conversation.item.create events in order (user/assistant/tool), and function_call_output for tool_result.
- During Realtime:
  - Continuously append transcripts, assistant outputs, tool_call and tool_result to canonical.
  - The text chat UI mirrors the same stream in near real-time.
  - If the user types a message, uploads an image, or a widget interaction generates input:
    - Append to canonical immediately.
    - Send into Realtime via data channel:
      - Text → input_text message + response.create (respecting current modalities policy).
      - Image → input_image (with mime_type and metadata) optionally preceded by input_text prompt.
      - Widget interaction → either function_call_output bound to a prior tool_call, or a tool_result-like message based on the interaction contract.
- Realtime stop:
  - Ensure any partial assistant output is consolidated and saved.
  - The next text submission builds its messages[] solely from the updated canonical log.
- Text mode:
  - Before sending, ensure the latest Realtime transcript (if any) is flushed to FileMaker (the web client calls saveSession({ history:true }) when Voice is closed).
  - Call Chat_TextRequest with { sessionId, message }. FileMaker selects the agent, loads history via Session_GetState, builds context, calls CallAgent, and appends assistant/tool events.
  - Persist updates via Session_SaveState on the FileMaker side.

6. API adapters
- Realtime adapter:
  - Preload: map canonical items to conversation.item.create; do not send function_call_output for historical tool results; instead inject assistant output_text lines describing prior tool calls/results to avoid priming tools.
  - Live mapping: response.created/response.delta/response.output → consolidate to assistant message(s); function_call(s) → tool_call entries; subsequent outputs → tool_result.
- Chat Completions adapter:
  - Build messages[] from canonical (user/assistant/system). Include essential tool results: either as “tool” role (newer schema) or fold concise tool summaries into assistant/system to keep context tight.
  - Token budgeting: sliding window with optional summarization; store summaries as system messages with metadata.summary=true.

7. Streaming and sentence consolidation
- Goal: avoid logging broken partials; store human-readable sentences/turns.
- Consolidation policy:
  - Maintain a transient buffer for the current assistant/user transcript while streaming.
  - Emit updates to UI live, but only append to canonical when:
    - A sentence boundary detected (. ! ? or newline) and an idle window elapses (e.g., 300–600ms), or
    - The response.done event arrives.
  - Replace/merge previous partials in UI; store only consolidated text to canonical.
- Apply the same policy to live user voice transcripts from Realtime.

8. Images and widget interactions during Realtime
- Image uploads from the text UI while Realtime is active:
  - Normalize to { base64, mimeType, prompt?, metadata? }.
  - Send as conversation.item.create with input_image (and optional input_text).
  - Append a user message with a note “[image shared]” or include prompt in canonical.
- Widget interactions (if applicable):
  - Treat as tool_result or a synthetic tool call per the widget’s contract.
  - Append to canonical; send appropriate function_call_output or input_text to Realtime so the model can react.

9. GridStack widgets and artifacts
- Artifacts from tool results spawn GridStack widgets programmatically (no palette/spawner).
- Each widget carries a widgetId linked to artifact.id and parent message.id.
- On added/change/removed/resizestop/dragstop → persist layout with Grid_SaveLayout(sessionId; grid.save()).
- Nice-to-have: scripted re-import of artifacts that were opened in native FileMaker windows back into GridStack.

10. UI requirements
- Chat window:
  - Scrollable, persistent; renders from canonical history.
  - Role indicator, timestamp, markdown rendering.
  - Tool calls: expandable with tool name, arguments JSON, result, status/duration/error.
  - Menu toggle: Show Tool Calls toggles display of tool call/result pills; clicking a pill opens details.
  - Streaming display with sentence consolidation.
- Status/controls:
  - Clear state badges: connected/listening/thinking/speaking/muted.
  - Error toasts and details modal (insufficient_quota, network, mic permissions).

11. Reliability and errors
- Rate limits and API errors: surface toast + modal detail; FM HandleAPIError(JSON); retry/backoff policy.
- Network drops: attempt reconnect; on new session, preload canonical again.
- Mic permissions: graceful fallback; allow text-only use.

12. Acceptance criteria
- Mode switching and concurrency:
  - While Realtime runs, typed messages/images appear in both chat and are processed by the model in real time.
  - Starting/stopping Realtime preserves context: next Text request uses the updated canonical log.
- Canonical history parity:
  - A multi-turn captured in Realtime yields the same canonical structure as if performed in Text mode.
- Artifacts:
  - Tool-produced artifact spawns a widget, persists, and links to its parent message.
- Grid:
  - Layout persists across reloads; remove via trash bin updates FM.

13. Assets to provide
- Starter HTML/JS for chat and grid.
- Example canonical JSON logs (Realtime + Text).
- Example tool calls/results with artifacts.
- Screenshots of prior tests for reference.

14. Progress to date
- Grid shell:
  - Integrated GridStack as the main workspace and initialized a 12-column grid.
  - Added header controls (Voice, Text, Debug Toasts) and a left sidebar for conversations.
- Realtime widget:
  - Encapsulated current canvas/overlays/audio UI inside a GridStack widget with header-only drag.
  - Fixed content injection by setting innerHTML on .grid-stack-item-content after addWidget.
  - Fixed resizing: canvas now sizes to the widget container via ResizeObserver (no window sizing).
  - Resolved overlay interference: 8px gutters around clickOverlay; resize handles/headers float above overlays.
  - Default size set to 4x4.
- Toasts widget:
  - Separated debug toasts into their own optional widget with a dedicated #toast-timeline container.
- Layout modes:
  - Two independent, user-configurable layouts are supported: Docked (sidebar visible) and Undocked (Conversations as a widget). Save Layout persists the current mode; switching modes attempts to load and apply the saved layout for that mode.
- Toggles and programmatic control:
  - Header hamburger menu (top-right) groups controls: buttons for Voice/Text/Debug Toasts/Show Tool Calls (active/inactive), Save Layout, Restore Default Layout, and Float On/Off toggle.
  - Conversations docking controlled by an anchor button in the sidebar and mirrored on the Conversations widget; undocking hides the sidebar and shows the widget; docking restores the sidebar and removes the widget.
  - setUISettings exposed to FileMaker to flip toggles programmatically; setUISettings({ convos: true }) undocks; setUISettings({ convos: false }) docks.
  - Save Layout (menu) saves the current mode as a machine template using the envelope shape above with scope:"machine" and calls Grid_SaveLayout; Restore applies the saved machine envelope.
  - Session layouts are authoritative and kept in memory; they are flushed to FileMaker with scope:"session" on session switch and Web Viewer close (optionally debounced on grid changes). Dock/undock applies the current session’s cached layout for that mode, falling back to machine template, then app defaults.
  - Reliability fixes:
    - Early JS stubs added in index.html buffer FileMaker callbacks (bootstrapApp/applySessionState/applyRealtimeInit) before module load; src/index.js drains pending payloads on DOMContentLoaded.
    - Deferred Realtime initialization until after bootstrap; added __rtInitInFlight guard to avoid double init.
    - Mute state persists across session switches.
    - Grid layout autosaves to session on drag/resize/change.
    - Removed redundant applySettingsForMode call during init to avoid double rebuild and unintended churn (commit a29ae69).
    - Added layout/settings MD5 debug logs and session-vs-machine gating; array payloads are persisted into cached settings before applying to prevent later overrides.

15. Next steps
- Initialization and per-user config
  - Add a bootstrap init path where FileMaker passes sessionId and initial settings to the WebView. The app should:
    - Load per-user defaults and per-mode layouts; if none exist, fall back to defaults.
    - Do not auto-start Realtime on page load. Only start Realtime (initializeWebRTC) when the Realtime widget is enabled/first brought on screen or explicitly requested.
    - Respect initial settings for which widgets are shown (voice/text/toasts) and float mode; apply via a single bootstrap call.
- Text Chat widget:
  - Implement unified chat UI that renders from the canonical log and supports streaming and tool nesting.
  - Support typing while Realtime is active; append to canonical and forward into Realtime (input_text/input_image).
- Canonical history + adapters:
  - Implement canonical JSON log read/write in both modes.
  - Build adapters:
    - Realtime: preload canonical via conversation.item.create; map response/function_call events to canonical.
    - Chat Completions: transform canonical → messages[] with token budgeting and optional summarization.
  - History handoff rules:
    - On Realtime start: preload the model state from the canonical log (per sessionId).
    - While Realtime runs: the Text widget mirrors the stream; any typed text/images are appended to canonical and injected into Realtime.
    - On Realtime stop: the next Text submission uses the updated canonical log (no gaps).
- Artifacts and tools:
  - Implement Tools_Invoke and map tool_call/tool_result into canonical.
  - Spawn artifact widgets programmatically from tool results and persist layout.
- Persistence:
  - Wire Grid_SaveLayout/Grid_LoadLayout to save/restore per-machine layouts (machineId) per session and per mode (docked/undocked).
  - Persist preferences per session via Session_SaveState; user defaults are updated only via Save Layout.
- Concurrency and synchronization:
  - Ensure typed messages/images during Realtime are appended to canonical and sent over the data channel immediately.
  - On Realtime stop, next text request uses updated canonical context.
- UX/quality:
  - Sentence consolidation for transcripts to avoid partial fragments.
  - Add devicePixelRatio scaling for the canvas for crisp rendering.
  - Error handling toasts + modal already scaffolded; integrate HandleAPIError.
- Validation:
  - Add simple end-to-end checks for mode switch, artifact spawn, and per-machine layout restore.

16. Initialization flow (per-user)
- FileMaker calls a bootstrap function (e.g., window.bootstrapApp) with:
  - sessionId: logical chat session identifier.
  - settings: { voice, text, toasts, float, mode: "docked"|"undocked" }.
  - sessions: an array of { id, title } for the sidebar list (the current sessionId is highlighted and clickable to switch).
- App behavior:
  - Load per-user saved layout for settings.mode if available; else load app defaults.
  - Apply settings to show/hide widgets; do not initializeWebRTC until Realtime is enabled.
  - If Realtime is enabled at bootstrap, initializeWebRTC only after mounting the Realtime widget.
  - Load canonical history for sessionId and render in Text widget; Realtime preload occurs when Realtime is started.
  - Note: FileMaker may call JS before the module loads; index.html defines early stubs to buffer callbacks and src/index.js applies pending payloads on DOMContentLoaded to prevent bootstrap races.

17. Impact on FileMaker scripts (see script.txt)
- Add App_Init(sessionId) to return:
  - Initial settings (voice/text/toasts/float, mode).
  - Saved layout for mode and user (or default).
  - Canonical chat history for sessionId.
- Update Grid_SaveLayout/Grid_LoadLayout to store/retrieve layouts by (SessionId, key) for session state and by (AccountName, key) for user defaults.
- Use Session_SaveState(sessionId; JSON) for updating settings within the unified session JSON (no separate Settings_SavePreferences script).
- Maintain canonical history rules across Realtime/Text as above.

18. Session state, persistence and flush policy
- In-memory is authoritative during an active session:
  - sessionHistory: append-only canonical JSON array for the current sessionId (user, assistant, tool_call, tool_result, artifacts). Bounded size in memory (sliding window, e.g., HISTORY_MAX_ITEMS=400) so oldest entries are dropped for UI/context building; FileMaker remains the source of truth.
  - sessionLayouts: per-mode settings for the current sessionId: { docked: {version, columns, cellHeight?, float, voice, text, toasts, layout[]}, undocked: {…} }.
  - These are kept in memory within the Web Viewer, with optional localStorage fallback for crash recovery during development.
- Two persisted layout stores:
  - Session state (sessionId + key): authoritative saved state for this chat. Save when you choose (e.g., on session switch or viewer close).
  - User defaults (AccountName + key): template/default for new sessions and “Restore Default Layout.” Updated only when the user clicks Save Layout.
- Precedence when applying a layout (for a given mode key):
  1) Session state (sessionId + key) if present.
  2) User defaults (AccountName + key) if present.
  3) App defaults.
- When to persist (minimize FileMaker round-trips):
  - History flushes (sessionId):
    - On assistant turn end (response.done).
    - On user transcript commit (conversation.item.input_audio_transcription.completed).
    - On tool_call and tool_result (including artifacts created).
    - On text submit (user typed message).
    - On session switch and on Web Viewer close (hard flush).
    - Optional: periodic autosave every 30–60s if there are unflushed history changes.
  - Layout flushes (sessionId + key):
    - On session switch and on Web Viewer close (flush if layout changed).
    - Optional: debounce 1–2s autosave on dragstop/resizestop/remove for robust recovery.
  - User templates (AccountName + key):
    - Only when the user clicks Save Layout in the menu (explicit action).
- JavaScript API surface (Web Viewer functions):
  - bootstrapApp({ sessionId, mode, settings? }): seeds state.
  - saveSession(options): upsert unified session JSON via Session_SaveState. options = { settings?: boolean, history?: boolean }.
  - saveSessionState(): alias for saveSession({ history: true }). Layout defaults are saved explicitly via the Save Layout menu action.
  - getSessionState(): returns { sessionId, mode, history, layouts: {docked, undocked}, dirty: {history, layout} } for FileMaker-side logic.
  - switchSession(newSessionId): calls saveSessionState(); loads new session layouts/history; updates in-memory state; re-renders using precedence.
- Dock/undock behavior:
  - On dock/undock toggle, apply the current session’s layout for that mode if available; otherwise fall back to the user template for that mode; otherwise app defaults. Keep the session layout authoritative and update it on the next flush.

19. History-only applySessionState fast path (safe mid-script UI updates)
- Contract:
  - Payload shape: { "sessionId": "S123"?, "history": [ ...canonical items... ] }
  - No settings/layout keys. When only history is present, JS updates sessionHistory and re-renders without making any JS→FileMaker calls.
- Use cases:
  - Chat_TextRequest progress updates from FileMaker: echo the user message, then tool_call pending, tool_result, and final assistant.
  - Mid-turn status updates where you want the Web Viewer to reflect progress but you must continue in the same FileMaker script.
- Behavior notes:
  - FileMaker’s “Perform JavaScript in Web Viewer” does not capture the JS return value; it runs JS and continues.
  - JS will not call FileMaker back during this fast path, so no scripts are queued. Your current script continues running.
  - If you include settings or layout keys, JS falls back to full bootstrapApp which may call FileMaker (e.g., Grid_LoadLayout). Avoid that during in-progress turns; send history-only.

20. Text mode turn patterns (exact ordering)
- Client-authored first (no flicker; no temp IDs needed):
  1) JS appends the user message to canonical and renders the bubble.
  2) JS calls Session_SaveState({ history }) so FileMaker has that user message.
  3) JS calls Chat_TextRequest({ sessionId, message, userItemId? }) to continue the turn (tools/assistant) on FileMaker.
  4) FileMaker appends tool_call/result and assistant, persists, then calls applySessionState({ history }) as progress/final updates.
- Server-authored (no local append):
  1) JS calls Chat_TextRequest({ sessionId, message }).
  2) FileMaker immediately appends the user message, persists, and calls applySessionState({ history }) so the bubble appears from canonical.
  3) FileMaker continues with tools/assistant; persists and calls applySessionState as desired.

21. IDs, metadata, and deduplication
- IDs:
  - JS-generated ids look like m_<base36Time>_<rand> (createId('m')); tool ids use tc_… and tr_….
  - FileMaker may generate UUIDs. Keep ids stable across multiple applySessionState updates within the same turn.
- Deduping user item (if using client-authored flow):
  - If JS passes userItemId, reuse it server-side or detect that the last history item is already that user message to avoid a duplicate.
- Metadata:
  - Use metadata.api = "realtime" for voice/RT events.
  - Use metadata.api = "chat_completions" for text-mode items.
  - Do not use metadata.source anymore; normalize to metadata.api.

22. Realtime → Text switch and flush policy
- On Realtime stop (mute/off/cleanup), flush consolidated history to FileMaker via Session_SaveState({ history:true }) so the next text turn has full context.
- If you can’t guarantee that flush, add a simple “dirty” check on the web side and pre-flush only once on the first text submit after Realtime.
- Minimal rule of thumb:
  - Flush on: response.done (assistant), user transcript commit, tool_call, tool_result, session switch, viewer close.
  - For text-only turns, don’t pre-flush if nothing is dirty; let FileMaker author the turn (server-authored) or append and save first (client-authored).

23. FileMaker ↔ JavaScript script queueing semantics
- FileMaker → JS:
  - Perform JavaScript in Web Viewer runs the JS function and immediately returns to your FileMaker script. There is no return value capture.
- JS → FileMaker:
  - Any FileMaker.PerformScript calls made by JS while a script is already running are queued and will run only after the current script finishes.
- Practical takeaway:
  - It’s safe to call window.applySessionState multiple times during a FileMaker script. Prefer history-only payloads to avoid any JS-initiated FM calls during that time.
