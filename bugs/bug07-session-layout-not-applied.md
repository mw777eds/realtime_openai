# Bug 07 — Session layouts not applied; machine defaults overriding positions

Status: Open

Severity: Medium (layout positions revert, reduces UX consistency)

Environment
- FileMaker Web Viewer (WKWebView/Safari)
- GridStack v10+
- index.html provides early stubs; src/index.js drains them on DOMContentLoaded
- Multiple sessions selectable from sidebar

Summary
When a session loads (initial load and when switching sessions), widget positions are not restored to the session-specific layout. Instead, the grid appears to use a user/machine default layout. Hashes of the saved and loaded settings confirm that the session layout arrives intact, but the applied positions do not match it.

Reproduction
1) Arrange widgets, then trigger a save of session state (auto on drag/resize or via Save Layout).
2) Switch to another session and back, or reload the viewer.
3) Observe that widgets snap to the user default layout rather than the just-saved session layout.

Expected
- Session layout (sessionId-scoped) should have precedence and be applied.
- User/machine default layout should only be used when no session layout exists for the current mode.

Root cause hypothesis
- After bootstrap (which seeds session layout into memory), a later Grid_LoadLayout callback may return a machine/default envelope lacking sessionId.
- applyLoadedLayout unconditionally applies any envelope (session or machine), overwriting the in-memory session-scoped persistedSettings for the current mode with machine defaults.
- Result: positions appear as user defaults even though the session layout was present and matches the saved MD5.

What changed recently
- Centralized layout application paths and front-end caching.
- Added applySettingsEnvelope/applyLoadedLayout to unify how loaded envelopes are applied.

Proposed fix (JS-only)
- Gate applyLoadedLayout so that:
  - If a session-scoped layout is already in memory for the current mode, ignore incoming envelopes that are not explicitly session-scoped for the current sessionId.
  - Only apply machine/default envelopes when no session layout is currently loaded for that mode.
- This preserves session precedence and prevents later machine/default callbacks from stomping the session layout.

Risks and mitigations
- If FileMaker returns only machine/default envelopes (no sessionId), they will be ignored once session layout is present; desired behavior.
- If FileMaker legitimately updates the session layout and includes sessionId matching current session, it will still apply.
- If the callback targets a different sessionId, it will be ignored.

Acceptance criteria
- On initial load: positions match the session layout exactly.
- On session switch: positions update to the selected session’s layout.
- No unintended overrides from machine/default envelopes when session layout is already present.
- No regression to bootstrap callback race (Bug 06) — stubs + drain order remain unchanged.

Debugging tips
- Temporarily log sources in applyLoadedLayout: sessionId, mode, whether session layout already present.
- Confirm persistedSettings[mode].layout length before and after callbacks.

Implementation plan
1) Modify src/index.js applyLoadedLayout to:
   - Parse payload.
   - Detect if we already have a session-scoped layout for current mode (persistedSettings[mode].layout length > 0).
   - Extract payload.sessionId (if present).
   - If we already have session layout and payload lacks sessionId or targets a different sessionId → return false (ignore).
   - Otherwise, forward to applySettingsEnvelope/applyLayout.

Workaround (until fixed)
- Ensure FileMaker returns the session-scoped envelope with sessionId for Grid_LoadLayout when a session layout exists.
- Avoid sending machine/default envelopes after session-scoped bootstrap for the same viewer lifecycle.

Related issues
- Bug 06 — Bootstrap callback race (ensure we don’t regress those guards).
