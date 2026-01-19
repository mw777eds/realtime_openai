# bug08: Grid layout not applied after bootstrap/session switch (widgets snap back)

Status: Open
Severity: High
Area: Grid/Layout and Settings (GridStack rebuild/apply)
Env: GridStack v10+, float=true, Web Viewer inside FileMaker

Summary
- After saving a layout and reloading (or switching to a session that shares the same layout), widgets do not render at the positions provided by the settings payload. The MD5 of the settings passed at init matches the saved layout, but on-screen positions revert to prior/original coordinates.
- This is not merely “floating up” a few rows. Example: the Realtime widget was dragged below the Text widget (different column and row), but after reload/switch it repositions above the Toasts widget at its original location.

Evidence (from FM debugger)
1) INIT: $$settingsMD5_INIT = D8DBC311FF... (baseline)
2) SAVE: $$settingsMD5_SAVE = CBA8DFC... (changed after dragging and saving)
3) LOAD (after reload): $$settingsMD5_LOAD = D8DBC311FF... or CBA8DFC... (depending on order), MD5s indicate the correct layout is passed on init
4) Switch to another session using the same config (pre-change): positions still don’t reflect the changed layout even though payload MD5 matches the saved state

Expected
- When bootstrapApp receives a layout with explicit x/y/w/h for each widget, the grid re-renders exactly at those coordinates, with no drift.
- Switching sessions that provide the same layout should render identically.

Actual
- Widgets (notably the Realtime/Voice widget) reappear at their original position above the Toasts widget, ignoring the newly saved x/y. This occurs even though the MD5 of the layout/settings matches what was saved and what is passed back on init.

Root cause hypothesis
- Our rebuild/apply code removes then re-adds widgets incrementally while:
  - GridStack float mode is enabled (float=true).
  - We don’t wrap the remove/add operations in grid.batchUpdate()/grid.commit().
  - We don’t force autoPosition: false on addWidget.
- GridStack may re-pack between incremental adds, moving previously inserted items and effectively ignoring the provided x/y as subsequent items are added.
- Result: deterministic placement is lost; the engine chooses positions aligned with original or earliest adds.

Scope in code
- src/index.js
  - rebuildFromLayout(layout, float, options)
  - applyLayout(payload)
  - addRealtimeWidget/addToastsWidget/addTextWidget/addConversationsWidget (calls to grid.addWidget)

Proposed fix
- Batch updates during rebuild/apply:
  - Call grid.batchUpdate() before removing/adding nodes and grid.commit() after.
- Deterministic add order:
  - Sort nodes by y ascending, then x ascending before adding to reduce collisions.
- Force exact placement:
  - Pass autoPosition: false when calling grid.addWidget({ x, y, w, h, autoPosition: false }).
- Keep float as configured, but batching + deterministic order prevents intermediate re-packs.

Acceptance criteria
- Save a layout with Realtime below Text (not sharing original column/row), reload page:
  - Widgets render exactly as saved; positions match the incoming layout.
- Switch to another session that uses the same saved layout:
  - Widgets render identically and remain stable.
- MD5s for INIT/LOAD/SAVE remain consistent; no extra saves triggered during initial render.

Notes
- This is not a FileMaker data issue. Payload MD5s demonstrate the correct positions are being passed. The issue is in how the front-end applies the layout.
- Risk of change is low; this doesn’t alter any business logic, only the way we stage GridStack operations to respect provided coordinates.

Hypotheses (general → specific) and null hypotheses
- H0 (null): The incoming settings payload does not contain the changed positions.
  - Observation: MD5s of settings/layout match across save and reload; screenshots show identical payload on init.
  - Status: Rejected (disproved).
- H1: One-column mode is engaging, causing GridStack to ignore x and stack by DOM/add order.
  - Mitigation: disableOneColumnMode: true in GridStack.init.
  - Status: Implemented; user reports no effect so far (not the sole/root cause).
- H2: Float mode re-packs between incremental add/remove operations during rebuild/apply.
  - Mitigation: Batch grid changes (grid.batchUpdate/commit) and temporarily set grid.float(false) during add, then restore.
  - Status: Implemented; user reports no effect so far (not the sole/root cause).
- H3: grid.addWidget default autoPosition (true) allows engine to choose positions.
  - Mitigation: Pass autoPosition: false for all addWidget calls.
  - Status: Implemented; user reports no effect so far (not the sole/root cause).
- H4: We persist “intended” rects (p) instead of the actual node positions GridStack settled on, leading to drift on the next round-trip.
  - Mitigation: After addWidget, persist el.gridstackNode {x,y,w,h}.
  - Status: Implemented; effect TBD in upcoming tests.
- H5: Hardcoded default widget positions override the saved layout during apply or when a widget is omitted in payload.
  - Mitigation: Removed DEFAULT_POS; adders now require a saved rect and do not inject defaults; Conversations widget only added if a saved rect exists.
  - Status: Implemented; effect TBD.
- H6: Programmatic layout application schedules an immediate save (Session_SaveState), overwriting the newly loaded layout with old positions.
  - Mitigation: Introduced mutatingLayout/applyingFromFM guards; scheduleSaveSettings only when prefsReady && !applyingFromFM; switchSession no longer saves settings (history only).
  - Status: Implemented; user still observed a save after switching; we tightened guards (commit 3b73e68). Verify with latest build.
- H7: Wrong mode key used during apply (e.g., applying ‘docked’ while UI is in ‘undocked’), so the wrong array is rendered.
  - Mitigation: Ensure apply paths use getCurrentMode() consistently and bootstrap persists the intended mode; verify payload key handling.
  - Status: Under observation (no specific defect confirmed yet).
- H8: A secondary rebuild path re-applies a stale cached layout after the intended apply (e.g., a localStorage fallback or a second apply after bootstrap).
  - Mitigation: applyingFromFM guard during bootstrap and applySettingsForMode(); removed pending DOMContentLoaded flush; will add a “quiet window” if needed.
  - Status: Under investigation.
- H9: Conversations docking transitions (dock/undock) implicitly add/remove the Conversations widget and shift grid positions when no saved rect exists.
  - Mitigation: Only add Conversations widget if a saved rect exists for the current mode.
  - Status: Implemented.
- H10: Grid options (cellHeight, columns) or CSS sizing mismatch cause unexpected collision/rounding, shifting rows on mount.
  - Mitigation: None yet; capture grid.engine.nodes before/after apply to detect rounding/column mismatches.
  - Status: Pending investigation.

What we have disproved so far
- Payload integrity (H0): Disproved by matching MD5s and visual verification.
- “Just floating up a bit”: Disproved by user observation; widgets are snapping back to prior/original positions, not merely shifting upward within the same column.
- “User drag didn’t save”: Disproved; MD5 changed after drag and that MD5 is reflected on next init.

Additional telemetry to capture in next test run
- Immediately before and after applySettingsForMode/rebuildFromLayout:
  - Incoming layout array for the active mode (as applied).
  - grid.engine.nodes mapped to {widget, x, y, w, h} to confirm what GridStack actually set.
  - Current mode key (docked/undocked), floatEnabled, grid.opts.column, grid.engine.column.
- On session switch:
  - Confirm no settings save is scheduled while applyingFromFM is true.
  - Confirm which apply path ran (applySettingsEnvelope vs direct array payload).
- On bootstrap:
  - Verify there is no save during or immediately after bootstrap (quiet).

Change log (related to this bug)
- 1874626: Batch grid updates; sort nodes by y/x; add widgets with autoPosition: false.
- ec5ec1f: Disable one-column mode; temporarily disable float during batched adds; persist actual node positions after add.
- a27905d: Remove hardcoded default widget positions; require saved rects; only add Conversations widget if saved rect exists.
- 3b73e68: Avoid spurious layout saves when applying layouts or switching sessions (do not save settings on switch; suppress saves when applyingFromFM).

Next steps if issue persists
- Add a short “apply quiet window” (e.g., 750ms) after applySettingsForMode to suppress any save scheduling and secondary applies.
- Log and compare grid.engine.nodes vs incoming layout immediately after grid.commit(); if mismatch, identify which widget collides and why (columns/rounding/constraints).
- Confirm that the active mode key matches the payload being applied at switch time (no cross-mode apply).
