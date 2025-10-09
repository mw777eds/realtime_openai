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
  - Maintain two saved layouts per machine and mode: Docked (sidebar visible) and Undocked (Conversations as a widget). Saved under machineId (and optionally sessionId if you prefer per-chat layouts).
  - Save Layout sends an envelope with scope: { scope: "machine" | "session", key, machineId, sessionId, settings { version, columns, cellHeight?, float, voice, text, toasts|debug, layout: [...] } } where layout is an array of nodes like { x, y, w, h, widget: "voice"|"text"|"toasts"|"convo" }.
    - When the user clicks Save Layout in the menu, scope must be "machine" (sets the default template for new sessions and Restore Default).
    - Session layouts are auto-saved with scope "session" at boundaries (session switch, viewer close), and may be debounced on drag/resize if desired.
    - If scope is omitted, FileMaker may infer scope as "session" when sessionId is present, otherwise "machine".
  - Restore loads the envelope for the current mode and applies settings (float and toggles) and settings.layout to rebuild widgets. If none is saved, defaults are applied and users can arrange, then Save Layout.
  - Front-end caching: on load, fetch both “docked” and “undocked” settings once and cache them in-memory; docking/undocking applies the cached settings immediately without a round-trip. Save Layout updates both FileMaker and the in-memory cache for the current mode.
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
  - Chat_SaveHistory(sessionId; JSON[]) → append/replace canonical log.
  - Chat_GetHistory(sessionId) → return canonical log.
  - Grid_SaveLayout(sessionId; JSON) / Grid_LoadLayout(sessionId).
  - Tools_Invoke(sessionId; JSON toolCalls[]).
  - HandleAPIError(JSON).

5. Synchronization rules
- Realtime is the source of truth while active.
- Realtime start:
  - Load canonical via Chat_GetHistory(sessionId).
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
  - Append user messages to canonical; call Chat Completions; append assistant + any tool events; persist.

6. API adapters
- Realtime adapter:
  - Preload: map canonical items → conversation.item.create; map tool_result → function_call_output.
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
  - Header hamburger menu (top-right) groups controls: buttons for Voice/Text/Debug Toasts (active/inactive), Save Layout, Restore Default Layout, and Float On/Off toggle.
  - Conversations docking controlled by an anchor button in the sidebar and mirrored on the Conversations widget; undocking hides the sidebar and shows the widget; docking restores the sidebar and removes the widget.
  - setUISettings exposed to FileMaker to flip toggles programmatically; setUISettings({ convos: true }) undocks; setUISettings({ convos: false }) docks.
  - Save Layout (menu) saves the current mode as a machine template using the envelope shape above with scope:"machine" and calls Grid_SaveLayout; Restore applies the saved machine envelope.
  - Session layouts are authoritative and kept in memory; they are flushed to FileMaker with scope:"session" on session switch and Web Viewer close (optionally debounced on grid changes). Dock/undock applies the current session’s cached layout for that mode, falling back to machine template, then app defaults.

15. Next steps
- Initialization and per-machine config
  - Add a bootstrap init path where FileMaker passes a persistent machineId and initial settings to the WebView. The app should:
    - Load per-machine configuration and per-mode layouts using machineId; if none exist, fall back to defaults.
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
  - Persist user settings (voice/text/toasts/float) per machineId so bootstrap can restore them.
- Concurrency and synchronization:
  - Ensure typed messages/images during Realtime are appended to canonical and sent over the data channel immediately.
  - On Realtime stop, next text request uses updated canonical context.
- UX/quality:
  - Sentence consolidation for transcripts to avoid partial fragments.
  - Add devicePixelRatio scaling for the canvas for crisp rendering.
  - Error handling toasts + modal already scaffolded; integrate HandleAPIError.
- Validation:
  - Add simple end-to-end checks for mode switch, artifact spawn, and per-machine layout restore.

16. Initialization flow (per-machine)
- FileMaker calls a bootstrap function (e.g., window.bootstrapApp) with:
  - machineId: persistent identifier for the host machine.
  - sessionId: logical chat session identifier.
  - settings: { voice, text, toasts, float, mode: "docked"|"undocked" }.
- App behavior:
  - Load per-machine saved layout for settings.mode if available; else load defaults.
  - Apply settings to show/hide widgets; do not initializeWebRTC until Realtime is enabled.
  - If Realtime is enabled at bootstrap, initializeWebRTC only after mounting the Realtime widget.
  - Load canonical history for sessionId and render in Text widget; Realtime preload occurs when Realtime is started.

17. Impact on FileMaker scripts (see script.txt)
- Add App_Init(sessionId; machineId) to return:
  - Initial settings (voice/text/toasts/float, mode).
  - Saved layout for mode and machineId (or default).
  - Canonical chat history for sessionId.
- Update Grid_SaveLayout/Grid_LoadLayout to store/retrieve layouts by (machineId, sessionId, key=mode).
- Add Settings_SavePreferences(sessionId; machineId; JSON) to persist toggle states per machine.
- Maintain canonical history rules across Realtime/Text as above.

18. Session state, persistence and flush policy
- In-memory is authoritative during an active session:
  - sessionHistory: append-only canonical JSON array for the current sessionId (user, assistant, tool_call, tool_result, artifacts).
  - sessionLayouts: per-mode settings for the current sessionId: { docked: {version, columns, cellHeight?, float, voice, text, toasts, layout[]}, undocked: {…} }.
  - These are kept in memory within the Web Viewer, with optional localStorage fallback for crash recovery during development.
- Two scopes of persisted layouts:
  - Session scope (sessionId + key): authoritative saved state for this chat. Always updated on meaningful boundaries (see below). Contains full layout for this session, including any session-only widgets (charts/artifacts).
  - Machine scope (machineId + key): template/default for new sessions and “Restore Default Layout.” Only updated when the user clicks Save Layout.
- Precedence when applying a layout (for a given mode key):
  1) Session scope (sessionId + key) if present.
  2) Machine scope (machineId + key) if present.
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
  - Machine templates (machineId + key):
    - Only when the user clicks Save Layout in the menu (explicit action).
- JavaScript API surface (Web Viewer functions):
  - bootstrapApp({ machineId, sessionId, mode, settings? }): seeds in-memory state for current session; do not start Voice until the Voice widget mounts.
  - SaveSessionState(): flush sessionHistory and sessionLayouts[current mode key] to FileMaker (Chat_SaveHistory + Grid_SaveLayout with scope:"session").
  - GetSessionState(): returns { sessionId, mode, history, layouts: {docked, undocked}, dirty: {history, layout} } for FileMaker-side logic.
  - SwitchSession(newSessionId): calls SaveSessionState(); loads new session layouts/history; updates in-memory state; re-renders using precedence.
- Dock/undock behavior:
  - On dock/undock toggle, apply the current session’s layout for that mode if available; otherwise fall back to machine template for that mode; otherwise app defaults. Keep the session layout authoritative and update it on the next flush.
