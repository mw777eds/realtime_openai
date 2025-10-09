# Bug 01 — Realtime widget does not resize correctly inside GridStack

Status: Resolved
Owner: Frontend
Created: 2025-10-09

Summary
- The Realtime widget’s canvas does not correctly resize to the GridStack item size. It appears sized to the window or otherwise ignores the grid cell dimensions. Resize handles also interfered with the overlay previously.

Environment
- GridStack: 12.3.3
- Build tool: Vite 6
- Runtime: macOS WebKit/Chrome inside FileMaker Web Viewer and standalone browser

Reproduction
1) Load the app (npm start).
2) Ensure “Voice” toggle is ON to mount the Realtime widget.
3) Resize the Realtime widget via the GridStack resize handles.
4) Observe: the waveform canvas does not expand/contract to the widget bounds; sometimes clicks on resize handles are intercepted.

Expected
- The canvas should fill the widget’s content area (.rt-body) and dynamically track size changes while dragging/resizing.
- Resize handles should remain clickable without silencing the Realtime API.

Observed
- Canvas appears to be using window.innerWidth/innerHeight, not the widget size.
- Overlay previously covered resize handles; partially mitigated by gutters.

Hypotheses (from most general to most specific)
1) Grid injection treats content as text, not DOM (Rejected)
   - If GridStack injects as textContent, we would see literal HTML (we did initially). We switched to setting innerHTML after addWidget and confirmed DOM now renders. Not the cause of current resize issue.

2) Canvas sizing logic uses the window instead of the container (Strong)
   - initializeCanvas sets canvas width/height = window.innerWidth/innerHeight. This will break in a tiled layout. Fix by sizing to the widget’s .rt-body using getBoundingClientRect().

3) Missing observer for dynamic size changes (Strong)
   - GridStack resizes the item; canvas needs a ResizeObserver on the container to follow size changes. Relying on window resize is insufficient.

4) Overlay intercepts pointer events over resize handles (Moderate)
   - The #clickOverlay used to span the full widget. We added 8px gutters and ensured resize handles have higher z-index. Verify handles are above overlay and pointer events reach them.

5) High-DPI rendering mismatch (Weak)
   - If we scale drawing buffer incorrectly (devicePixelRatio), visuals can stretch or blur, but it won’t prevent sizing. A later enhancement can scale for retina once sizing is correct.

6) GridStack CSS not fully applied (Weak)
   - If gridstack.min.css doesn’t load, sizes/handles are wrong. We import it in src/index.js; verify it’s present in the built bundle (Vite single-file plugin should inline it).

Null Hypotheses (ways this is not the root cause)
- Not a browser zoom issue: behavior persists at 100% zoom.
- Not a WebRTC issue: audio pipeline is independent of canvas size.
- Not a transform-only change: GridStack updates item size; we can observe .rt-body rect changes directly.

Investigation plan
- Change initializeCanvas to size from .rt-body via getBoundingClientRect(); remove window sizing.
- Add a ResizeObserver on .rt-body to keep canvas sized during drag/resizes.
- Ensure the overlay leaves gutters and keeps z-index below resize handles.
- Verify handles are clickable: check elementFromPoint at edges; confirm pointer-events reach .gs-resize-handle.
- If needed, add grid.on('resizestop') to force a final canvas resize.

Resolution (final)
- Root causes:
  - GridStack injected widget content as text when using options.content; fixed by setting innerHTML on .grid-stack-item-content after addWidget.
  - Canvas sizing used window dimensions; fixed by measuring .rt-body and using a ResizeObserver to track changes.
  - Overlay covered resize handles; fixed by adding 8px gutters and ensuring resize handles/headers sit above overlays; drag restricted to .gs-handle.
- Implemented changes in code:
  - Widgets are created via grid.addWidget(...) and then innerHTML is set on .grid-stack-item-content (Realtime, Toasts, Text).
  - initializeCanvas resizes to the container and installs a ResizeObserver; observer is disconnected on widget removal.
  - clickOverlay leaves an 8px perimeter gutter; CSS ensures resize handles z-index above overlays.
  - GridStack configured with dragHandle and header-only drag.
- Default size set to 4x4 for the Realtime widget.

Validation
- Manual resize across multiple sizes confirms the waveform matches the widget; handles are clickable and do not mute the session.
- Rapid resizing shows no overlay interference or flicker.
- Bug considered resolved.

Follow-ups
- Enhancement: devicePixelRatio-aware canvas for retina rendering.
- Optional: Call resizeToContainer on grid resizestop for belt-and-suspenders.

Rollback plan
- Revert to window sizing if observer causes instability (not expected).

Links / Context
- GridStack docs: https://github.com/gridstack/gridstack.js
- Prior issue: content injected as text, fixed by using innerHTML after addWidget.
