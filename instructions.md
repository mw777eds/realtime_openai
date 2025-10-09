FileMaker AI Chat + Real-Time API Unified Interface — Requirements Document

1. Overview

The goal is to create a unified chat interface that works with both:
	•	the OpenAI Real-Time API (already operational), and
	•	the Chat Completions API (already scripted and functional).

Both APIs must use the same visual chat interface, allowing seamless switching between them.

⸻

2. Current System
	•	Real-Time API: fully working (voice input/output, real-time responses).
	•	Chat Completions: existing FileMaker scripting handles completions and tool calls.
	•	Chat History:
	•	Real-Time API → history already logged.
	•	Chat Completions → requires integration to include historical messages.
	•	Tool Calls: captured by scripting but not yet stored or displayed in the chat log.

⸻

3. Requirements

3.0 Grid Container (GridStack)
	•	Library: GridStack.js (current site lists v10+). Use the bundled gridstack-all.js + gridstack.min.css.
	•	Grid options (initial):
	•	column: 12 (desktop), oneColumnModeDomSort: true (mobile stacking), cellHeight: 8 (px) with cellHeightUnit: 'px', margin: 6.
	•	float: true (allow free placement without strict packing).
	•	acceptWidgets: true (allow drag-in of new widgets/artifacts).
	•	draggable: { handle: '.gs-handle', scroll: true }, resizable: { handles: 'e, se, s, sw, w' }.
	•	Persistence via grid.save() → store JSON in FileMaker per session/layout; restore via grid.load(items, addRemove=true).
	•	External drag-in (tool/artifact spawner): expose a palette area with elements having data-gs-* attributes; enable via GridStack.setupDragIn(...) or equivalent pattern; grid will create widgets on drop.
	•	Trash bin to remove items:
	•	Provide a fixed drop zone (e.g., header/footer bin) with class .trash-bin.
	•	Initialize grid with removable: '.trash-bin'. Removal feedback is immediate on hover; actual removal occurs on mouseup (per v4+ behavior).
	•	On removed event, call FM script to delete the widget record and detach any WebViewer children.
	•	Show confirmation for destructive remove if widget has unsaved state.
	•	Events to wire: added, change, removed, dragstart/dragstop, resizestart/resizestop. Persist on change/removed.
	•	Accessibility: give widgets aria roles and focus/keyboard re-ordering affordances.
	•	Cross-iframe content: prefer same-page modules for tight coupling; if using iframes, communicate via postMessage channel keyed by widgetId.
	•	References: Advanced demo shows built-in trash-can removal and drag-in widgets; API mentions removeTimeout removed in v4 and immediate trash feedback. [Docs / site referenced below]

3.1 Chat Window UI
	•	Build a scrollable, persistent chat window (HTML or Web Viewer based).
	•	Each message block should include:
	•	Role indicator (user, assistant, tool).
	•	Timestamp.
	•	Message text (markdown-rendered).
	•	For tool calls → expandable section showing:
	•	tool name
	•	arguments (JSON formatted)
	•	returned result (if available)
	•	Support for streaming messages (typing effect for Real-Time API output).
	•	Allow message history to be loaded from FileMaker records on open.

3.2 History Capture
	•	For Real-Time API:
	•	Already stores message history → integrate into display.
	•	Extend capture to include tool_call and tool_result events.
	•	For Chat Completions API:
	•	Append each message (and tool call) into the same log structure.
	•	If multiple tools are used, retain sequence order.

3.3 Display + Storage
	•	Store all chat elements (user messages, assistant responses, tool calls) in FileMaker JSON fields.
	•	Display structure:

{
  "role": "assistant",
  "content": "Response text…",
  "timestamp": "2025-10-08T12:00:00Z",
  "type": "message|tool_call|tool_result"
}


	•	Load this JSON to populate the chat UI dynamically.

3.4 Integration Hooks
	•	Maintain existing FileMaker script architecture for:
	•	Perform Script on Server callbacks.
	•	Insert from URL API requests.
	•	Add new functions:
	•	Chat_SaveHistory ( sessionID ; JSON )
	•	Chat_GetHistory ( sessionID )

3.5 Logging & Tool Display
	•	Extend Real-Time API logging to include:
	•	function_call or tool_call objects.
	•	Success/failure status and duration.
	•	In UI:
	•	visually nest tool results beneath the related assistant message.
	•	highlight errors (e.g., red border or icon).

⸻

4. Assets to Provide to Developer
	•	Starter HTML/JS for the chat window (existing partial code).
	•	Screenshots of previous test interfaces.
	•	Example JSON logs from Real-Time API.
	•	Example output from Chat Completions API with tool calls.

⸻

5. Deliverables
	•	Working HTML chat interface embedded in FileMaker Web Viewer.
	•	Unified JSON logging structure for both APIs.
	•	Proper display of messages, tool calls, and results.
	•	Verified compatibility with existing FileMaker scripts for real-time and non-real-time use.