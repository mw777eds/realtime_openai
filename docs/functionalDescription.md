# Empowered Agents Web App — Functional Description (Beginner-Friendly)

> **Note:** This document describes the core architecture and FileMaker integration patterns.
> For current features including GridStack widgets, session management, and layout persistence,
> see [README.md](../README.md) and [instructions.md](instructions.md).

---

This document explains, from the ground up, how the web app works, how it talks to FileMaker, what the "canonical history" is, and which FileMaker scripts are expected. It's written to be approachable if you're new to this stack.

Contents
- 1) Big Picture
- 2) Files and Responsibilities
- 3) The Canonical History Model
- 4) UI, Widgets, and Layouts (GridStack)
- 5) Realtime (Voice) vs Text (Chat) Modes
- 6) Exact Data Flows (Step‑by‑Step)
- 7) FileMaker <-> JavaScript Bridge (How Calls Behave)
- 8) Required FileMaker Scripts (API Contract)
- 9) Practical “Gotchas” and Recommendations

---

## 1) Big Picture

You have one UI that can run in two modes:

- Realtime mode (voice)
  - Uses WebRTC to connect to OpenAI’s Realtime API.
  - Streams audio, sends/receives JSON events on a data channel.
  - We “preload” conversation state into the live session and mirror everything into a single history.

- Text mode (chat)
  - FileMaker runs the turn (user → optional tools → assistant), persists the result, and notifies the Web Viewer to refresh.

Golden rule: there is one “canonical history” (an array of items) per session. The UI renders from, and saves to, that single source of truth.

---

## 2) Files and Responsibilities

- index.html
  - Static HTML shell.
  - Defines early “stubs” for window.bootstrapApp, window.applySessionState, window.applyRealtimeInit so FileMaker can call them even before JS finishes loading (payloads are buffered).

- src/index.js
  - The main app code (state, UI, GridStack, Realtime/WebRTC, chat, and FileMaker bridge).
  - Exposes many window.* functions that FileMaker can call.

- src/style.css
  - Styles for header, sidebar, widgets (Voice canvas, Text chat, Toasts), and GridStack specifics.

- docs/functionalDescription.md (this file)
  - Human-friendly explanation + FileMaker API contract.

- script.txt (reference)
  - Example FileMaker script specs (parameters, behavior) you can adapt into your own scripts.

---

## 3) The Canonical History Model

A single array called sessionHistory in JS holds items:

- Message
  - { id, ts, role: 'user'|'assistant'|'system', type: 'message', content: 'text', metadata: { api: 'realtime'|'chat_completions' } }

- Tool call (model asking to run a tool)
  - { id, ts, role: 'tool', type: 'tool_call', content: null, metadata: { tool: { name, arguments }, responseId? } }

- Tool result (your tool has finished)
  - { id, ts, role: 'tool', type: 'tool_result', content: <string or object>, metadata: { call_id, status, error? } }

Why this matters: saving a session means sending sessionHistory to FileMaker; updating the UI means replacing sessionHistory from FileMaker. This keeps UI and storage consistent.

---

## 4) UI, Widgets, and Layouts (GridStack)

- Widgets:
  - Voice (Realtime): waveform, mic toggle.
  - Text: chat messages, input box, image upload.
  - Toasts: right/left toasts/pills for events.
  - Conversations: session list (dockable as a widget).

- GridStack:
  - Manages x/y/w/h positions for widgets in a 12‑column grid.
  - Two modes:
    - Docked: fixed sidebar visible (Conversations lives there).
    - Undocked: sidebar hidden; Conversations becomes a draggable/resizable widget.
  - Per‑mode layouts are saved/restored (docked vs undocked).

- persistedSettings (JS) + FileMaker scripts:
  - You can Save Layout (user defaults) and Restore Default Layout.
  - Session state (history) is separate from layout saving.

---

## 5) Realtime (Voice) vs Text (Chat) Modes

- Realtime:
  - JS asks FileMaker for ephemeral credentials (Realtime_Init).
  - JS creates a WebRTC connection (pc + data channel).
  - JS preloads prior history into the live session.
  - As events arrive (transcripts, function calls, assistant output), JS appends to sessionHistory and updates the UI immediately.

- Text:
  - When Realtime isn’t connected, typed messages go through FileMaker via Chat_TextRequest.
  - FileMaker appends items (user → tool_call → tool_result → assistant), persists changes, then calls window.applySessionState with the updated history so the UI redraws.

Both paths converge on the same sessionHistory array.

---

## 6) Exact Data Flows (Step‑by‑Step)

A) Startup
1. index.html loads; stubs buffer early FM calls.
2. src/index.js DOMContentLoaded:
   - Wires UI, initializes GridStack, loads any cached layouts.
   - If Voice widget is present, JS asks FileMaker to init Realtime.
   - Renders sessions, applies initial mode (docked/undocked).

B) Realtime turn (speaking or typing while Realtime is connected)
1. JS sends input (audio/text/image) over the data channel.
2. Model responds; JS appends assistant messages, tool calls/results into sessionHistory.
3. UI updates immediately from sessionHistory.
4. When Voice is turned off or the page closes, JS flushes sessionHistory to FileMaker (Session_SaveState).

C) Text turn (Realtime not connected)
Two good patterns; pick one:

- Client-authored first (simple, no flicker):
  1) JS appends the user message to sessionHistory and renders the bubble.
  2) JS calls Session_SaveState({ history }) so FileMaker has it.
  3) JS calls Chat_TextRequest to continue (tools/assistant) on FileMaker.
  4) FileMaker appends tool and assistant items, persists, and calls applySessionState to refresh the UI.

- Server-authored:
  1) JS calls Chat_TextRequest immediately (no local append).
  2) FileMaker appends the user message first, persists, and immediately calls applySessionState so the UI shows the canonical bubble.
  3) FileMaker continues with tools/assistant, persisting and calling applySessionState as the turn progresses.

D) Session switch
1) JS saves current session history.
2) JS sets a new sessionId and asks FileMaker for that session’s state (Session_GetState).
3) FileMaker returns state; JS replaces sessionHistory and re-renders.

---

## 7) FileMaker <-> JavaScript Bridge (How Calls Behave)

- FileMaker → JS:
  - “Perform JavaScript in Web Viewer” runs the JS function and returns to FileMaker immediately.
  - You cannot capture the JS return value in the script step.
  - The JS can mutate the DOM instantly; your FM script continues.

- JS → FileMaker:
  - JS can call window.FileMaker.PerformScript(...) (callFM wrapper).
  - If a FileMaker script is already running, the new script is queued and runs after the current script finishes.

Implication:
- It’s safe to call window.applySessionState from FileMaker in the middle of your script; your script won’t be interrupted.
- If you want to avoid any queued callbacks, pass a “history-only” payload and let JS apply a history‑only fast path (no FM calls from JS).

---

## 8) Required FileMaker Scripts (API Contract)

These script names align with window.FM_SCRIPTS in JS. Required unless marked “optional”.

1) Session_SaveState (required)
- Purpose: Upsert the unified session JSON (merge only provided keys).
- Params (JSON): { "sessionId":"...", "settings":{...}?, "layout":{ "docked":[...], "undocked":[...] }?, "history":[ ... ]? }
- Behavior: Merge provided keys into stored JSON (session-scoped). Update timestamps.

2) Session_GetState (required)
- Purpose: Return the unified session JSON.
- Params (JSON): { "sessionId":"..." }
- Return via “result”: { sessionId, settings?, layout?, history? }

3) Grid_SaveLayout (required for user defaults)
- Purpose: Save the current mode’s layout/settings as per-user defaults.
- Params (JSON): { "key":"docked"|"undocked", "sessionId":"...", "settings": { version, columns, cellHeight?, float, voice, text, toasts, showToolCalls?, layout:[...] } }
- Behavior: Store per-user defaults under (AccountName + key). Does not overwrite session state.

4) Grid_LoadLayout (required)
- Purpose: Load layout/settings envelope for a mode, preferring session-scoped state; else user defaults.
- Params (JSON): { "sessionId":"...", "key":"docked"|"undocked" }
- Return envelope: { key, sessionId?, settings:{ version, columns, cellHeight?, float, voice, text, toasts, showToolCalls?, layout: { docked?:[], undocked?:[] } } }

5) Grid_RestoreDefaultLayout (required)
- Purpose: Return a default layout envelope (for reset).
- Params (JSON): { "sessionId":"...", "key":"docked"|"undocked" }
- Return an envelope with only that key’s default nodes.

6) Realtime_Init (required for voice)
- Purpose: Generate ephemeral OpenAI key + session config; JS will start WebRTC.
- Params (JSON): { "sessionId":"..." }
- JS callback: window.applyRealtimeInit({ success:true, result: { ephemeralKey, model, instructions, tools, toolChoice, sessionConfig } })

7) Chat_TextRequest (required for text mode)
- Purpose: Run a text-only turn (append user → tools → assistant).
- Params (JSON): { "sessionId":"...", "message":"...", "userItemId"?: "..." }
- Behavior:
  - Load Session_GetState.
  - Append user message (use userItemId if provided to avoid dupes) OR dedupe if the last item already matches.
  - Session_SaveState; immediately call window.applySessionState({ sessionId, history }) so UI shows the user bubble from canonical.
  - Run agent/completions.
  - On tool requests: append tool_call (status:"pending"); save; optionally call applySessionState to show pills.
  - On completion: append tool_result (status, error?, durationMs?); save; optionally call applySessionState.
  - Append assistant message; save; call applySessionState (final).

8) CallTools (required when using tools)
- Purpose: Execute tool calls emitted by the model and send outputs back to JS.
- Params (JSON): { "toolCalls":[ { name, call_id, arguments }, ... ] }
- Behavior: For each tool, run workflow; then in Web Viewer call:
  - window.sendToolResponse(JSON.stringify({ call_id, output }))
  - After last, call window.createModelResponse()

9) Session_New (required if using “New Conversation” UI)
- Purpose: Create a new session record and seed minimal state.
- Params (JSON): { "title"?: "string", "previousSessionId"?: "string" }
- Behavior: Create record, set $$SessionId, optionally return/apply initial state.

10) Chat_SendMessage (optional; simple fallback)
- Purpose: Legacy text-mode path (if not using Chat_TextRequest).
- Params (JSON): { "sessionId":"...", "message":"..." }
- Behavior: Append user; call OpenAI Chat Completions; append assistant/tool events; save; optionally call applySessionState.

11) LogMessage (optional)
- Purpose: Audit/log a single line.
- Params (JSON): { "role":"user"|"assistant", "message":"..." }

12) ShowJSON (optional; dev utility)
- Purpose: Show a JSON blob in a developer card window.

13) HandleAPIError (recommended)
- Purpose: Centralize error logging for quota/network errors and notify user.
- Params (JSON): { "code":"...", "message":"...", "type":"..." }

Tip: Keep ids stable across multiple applySessionState calls within the same turn to avoid duplicates in the UI.

---

## 9) Practical “Gotchas” and Recommendations

- Why “my first SaveState was empty?”
  - You saved before appending the user message locally. Either append first (client-authored) or let FM append and immediately call applySessionState (server-authored).

- Will applySessionState interrupt my current FileMaker script?
  - No. FM runs the JS and continues. JS does not call back into FileMaker unless you explicitly call FileMaker.PerformScript. Any such calls are queued and run after the current script ends.

- History-only apply
  - JS now implements a history‑only fast path in window.applySessionState. If your payload has only { sessionId?, history[] }, JS updates the UI without making any FileMaker calls.

- Realtime stop
  - When Voice is turned off, flush history to FileMaker (Session_SaveState) so the next text submit has full context.

- Consistent metadata
  - Use metadata.api = "realtime" for Realtime events, "chat_completions" for text-mode events.

- No need for temporary IDs
  - You only need a temp id if you render a local “pending” bubble but let FM author the canonical user message and you want to dedupe perfectly. If you append locally and save before calling Chat_TextRequest, you don’t need this.

With this model, your UI, Realtime, and FileMaker scripts align around a single canonical history and predictable, debuggable flows.
