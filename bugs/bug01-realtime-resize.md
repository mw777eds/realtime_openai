# Bug 01 — Realtime widget does not resize correctly inside GridStack

Status: Open
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

Fix implemented (current)
- initializeCanvas now:
  - Locates the closest .rt-body and sizes the canvas to its rect.
  - Attaches a ResizeObserver to re-size on layout changes.
  - Disconnects previous observer when removing the widget.
- Realtime widget default size changed to 4x4.

Next steps / Validation
- Manual: Drag to multiple sizes; confirm waveform matches widget.
- Edge: Rapid resize; verify no flicker and no overlay intercept clicks on handles.
- Optional: Add devicePixelRatio scaling for crispness (post-fix).
- Optional: Hook grid ‘resizestop’ to call the same resize function.

Rollback plan
- Revert to window sizing if observer causes instability (not expected).

Links / Context
- GridStack docs: https://github.com/gridstack/gridstack.js
- Prior issue: content injected as text, fixed by using innerHTML after addWidget.
