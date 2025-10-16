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
