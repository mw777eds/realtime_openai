# Bug 09 - Last tool pill not cleared when Show Tool Calls is OFF

## Symptoms
When "Show Tool Calls" is OFF, a tool_result pill remains visible even after a subsequent assistant text message is appended. The UI ends up showing:
- message, message, pill
instead of:
- message, message, message
Pills should only appear when the last item in history is a tool_call or tool_result. As soon as a message follows, the pill should disappear.

Observed in Realtime mode (and likely in Text mode), as shown in the screenshot where the "Show Tool Calls" toggle is OFF but a "Tool result: ..." pill is still displayed above an assistant message.

## Hypotheses and Null Hypotheses

1. Hypothesis: Mixed render paths leave a stale pill in the DOM.
   - Null Hypothesis: Forcing a full chat re-render after assistant text is appended (when Show Tool Calls is OFF) will not remove the stale pill.
   - Status: TESTING
   - Evidence: Tool result path uses renderChatFromHistory(), but assistant text path uses appendChatMessage(...) which appends DOM without re-render; stale pill can persist.

2. Hypothesis: The rule "show only the last pill when OFF" is correct, but we are not re-rendering on assistant text append to enforce it.
   - Null Hypothesis: After appending an assistant message, calling renderChatFromHistory() (when Show Tool Calls is OFF) still renders a pill above it.
   - Status: UNTESTED
   - Evidence: Current code re-renders on tool_result; does not guarantee a re-render on assistant text append in Realtime.

3. Hypothesis: Text mode may not exhibit this because applySessionState fully re-renders; issue primarily affects Realtime where we mix incremental DOM appends and full renders.
   - Null Hypothesis: Reproducing the bug in Text mode shows the same stale pill behavior even after applySessionState.
   - Status: UNTESTED
   - Evidence: Not yet tested in Text; suspected safe due to history-only fast-path re-render.

## Additional Notes
- Repro steps:
  1) In Realtime, trigger a tool call that yields a tool_result (pill shows as last item).
  2) The model then emits an assistant text message.
  3) With Show Tool Calls OFF, the last pill remains visible even though a message follows it.
- Expected behavior: With Show Tool Calls OFF, render only if the final history item is a tool_call/tool_result; once a message is appended, no pill should remain.
- Likely fix direction:
  - In the Realtime assistant append path (response.done with transcript), after appendChatMessage('assistant', ...), if (!showToolPills) renderChatFromHistory(); This ensures the stale pill is dropped when a message becomes last.
  - Keep the tool_result path re-render as-is; do not re-render on tool_call events.
- Acceptance criteria:
  - With Show Tool Calls OFF, pills only show when they are the final history item; as soon as an assistant message is appended, no pills remain between messages.
  - With Show Tool Calls ON, all pills are rendered as they are today.
