# Bug 03 - Layout not applied after bootstrap; Text widget not shown

## Symptoms
- FileMaker calls window.bootstrapApp with:
  - success: true, result: { key: "docked", settings: { float, voice:true, text:true, toasts:true, layout:[...] }, history:[...] }
- Chat history buffers (and renders if Text is already mounted).
- Grid widgets are not positioned per settings.layout.
- Text widget often not visible on first load despite settings.text = true and layout including a "text" node.

Expected: On bootstrap, the grid applies the provided layout and mounts Voice/Text/Toasts accordingly.

## Hypotheses and Null Hypotheses

1. Hypothesis: Race condition — bootstrapApp is called after DOMContentLoaded initial mount ran, but bootstrapApp defers applying the layout (it only “seeds” caches). Since no subsequent apply is triggered, default UI persists (Voice/Toasts on, Text off).
   - Null: If we manually call applySettingsForMode(window.__bootstrapMode) (or dock/undock then apply) after bootstrapApp returns, the layout still doesn’t apply.
   - Status: TESTING
   - Evidence: Code path shows bootstrapApp seeds persistedSettings and __bootstrapMode, but does not apply if grid is already initialized. Initial mount only applies once, before FM call in some timings.

2. Hypothesis: Menu toggle state overrides — since initial toggles default to Text off, syncWidgets may remove Text unless applySettingsForMode first updates the toggles.
   - Null: After calling applySettingsForMode(mode), toggles correctly reflect Text on and the widget remains mounted.
   - Status: UNTESTED

3. Hypothesis: Mode/dock mismatch — dockConvos/undockConvos side-effects cause a secondary apply that overrides layout.
   - Null: Forcing a single apply sequence (set isConvosDocked and call applySettingsForMode once) yields the same failure.
   - Status: UNTESTED

4. Hypothesis: GridStack addWidget API misuse — created items aren’t adopting x,y,w,h.
   - Null: Directly adding a test widget with known x/y/w/h via grid.addWidget then grid.save() reflects correct positions.
   - Status: UNTESTED

## Additional Notes
Relevant code:
- bootstrapApp: seeds chatBuffer and persistedSettings[mode], sets window.__bootstrapMode, but defers applying.
- DOMContentLoaded: initializes GridStack, then chooses bootMode = window.__bootstrapMode || 'docked', calls dockConvos()/undockConvos(), then applySettingsForMode(bootMode). If bootstrapApp runs after this point, nothing re-applies the seeded layout.

Suggested quick test (DevTools):
- After FM calls bootstrapApp and the UI is wrong, run:
  - window.__bootstrapMode // confirm "docked"
  - typeof grid // confirm initialized
  - applySettingsForMode(window.__bootstrapMode) || loadLayoutForCurrentMode() || window.__syncWidgets?.()
  - Expected: layout and Text widget appear.

Proposed fix (first attempt):
- Expose grid/widget helpers (add/remove/dock/undock/sync) on window so top-level functions can invoke them.
- In bootstrapApp, if grid is initialized, immediately:
  - Align dock state via window.__dockConvos/window.__undockConvos.
  - Call applySettingsForMode(mode) or fallback to loadLayoutForCurrentMode(), else window.__syncWidgets().
- Update rebuildFromLayout/applyLayout to call the exposed window helpers to avoid scope issues.
