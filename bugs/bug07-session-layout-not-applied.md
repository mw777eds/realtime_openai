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

Update 1 (investigation + next attempted fix)
- New observations:
  - The loaded payload MD5 matches the saved session layout MD5, but the grid still ends up using machine defaults.
  - In cases where FileMaker returns a direct array payload shape ({ layout:[...] }) instead of a full envelope ({ key, settings:{ layout:{docked,undocked} } }), our previous code path applied the layout to the grid (applyLayout) but did not update in-memory persistedSettings for that mode. A subsequent apply/applySettingsForMode/sync could then overwrite the grid using the cached machine defaults, making it look like the session layout was ignored.
  - Gating in applyLoadedLayout also treated “any existing layout” as authoritative which could cause us to ignore a correct session layout if an earlier machine template was cached.

- Hypothesis update:
  - Session layout is being received correctly but is not persisted into persistedSettings on the “array payload” path, so later flow re-applies the machine layout.
  - Additionally, we should track “source” (session vs machine) for persistedSettings per mode so that a later machine/default envelope can be safely ignored when a session-scoped layout has already been applied for the current session.

- Attempted fix (applied):
  - Treat array payloads as authoritative for the current mode:
    - Persist into persistedSettings[currentMode].layout (and float if provided) and mark __source ('session' when payload.sessionId matches current session, else 'machine') and __sessionId.
    - Then call applySettingsForMode(currentMode) so all subsequent operations use the same source-of-truth path.
  - Improve gating:
    - If payload targets a different sessionId → ignore.
    - If we already hold a session-scoped layout for this session and the incoming payload has no sessionId (machine/default), ignore the override.
  - Add extensive console logging:
    - MD5 of settings/layout on upload (Grid_SaveLayout and Session_SaveState with settings).
    - MD5 on load for both envelope and array payloads.
    - Logs for applySettingsForMode/applyLayout/rebuildFromLayout with mode, counts, and MD5s.
    - Logs for Grid_LoadLayout requests and whether a payload is applied or ignored, including source detection.
    - “Pending first-change” guard: if a drag/resize happens before prefsReady is true, set a flag and flush settings once ready (helps diagnose the “first move not saving” suspicion).

- Secondary issue (first move/resize not saving):
  - Added detection: if grid change events fire before prefsReady, we mark window.__pendingLayoutDirty = true and flush settings once prefsReady becomes true at the end of DOMContentLoaded.
  - Added console logs to trace the first-change flow.

- Next steps:
  - Run through session switch and initial load while watching the console:
    - Look for [Grid_LoadLayout], [applyLoadedLayout], [applySettingsEnvelope], [applySettingsForMode], [rebuildFromLayout] logs with MD5 values.
    - Confirm that when a session layout is returned, it is persisted (shows __source=session) and later operations don’t overwrite it with machine/default.
  - If the MD5s still show correct values but positions differ, we’ll instrument per-node logs (x,y,w,h per widget) next.

Update 2 (console logs analysis)
- Bootstrap seeds session layouts with MD5s 08bfb48… (docked) and f094028… (undocked), confirming session-scoped payloads arrive.
- During init, a second apply shows MD5 change to bee698b… — this reflects client-side normalization, not a switch to machine defaults.
- After moving/resizing, uploads show evolving md5_docked values; saves are firing.
- On reload, FileMaker returns the original docked MD5 (08bfb48…) instead of the latest uploaded MD5, indicating the session layout is not being round-tripped from FM.
- JS change deployed to remove redundant init apply (a29ae69) to avoid double rebuild; gating and MD5 diagnostics are in place.

Next steps
- Verify FileMaker scripts persist session layouts on Session_SaveState and prefer them in Grid_LoadLayout (return sessionId with session-scoped envelopes).
- Optional dev fallback: client can prefer the newest local cached session layout if FM returns an older MD5 for the same session+mode.

Status: Open (awaiting FileMaker-side verification; JS gating/logging in place)
