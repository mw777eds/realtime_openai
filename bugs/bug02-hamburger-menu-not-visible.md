# Bug 02 — Hamburger menu not visible in header (top-right)

Status: Open
Owner: Frontend
Created: 2025-10-09

Summary
- The hamburger (three horizontal lines) button that should appear in the header’s right-side controls is not visible. The header area renders, but the menu toggle isn’t seen or is obscured.

Environment
- App runs in FileMaker Web Viewer and standalone browser (macOS).
- GridStack active with Realtime and Toasts widgets.
- Relevant elements:
  - Header: `.app-header`
  - Menu button: `#menu-toggle.menu-toggle` containing three `<span class="bar">`
  - Menu panel: `#menu-panel.menu-panel`

Reproduction
1) Load the app.
2) Observe header’s right side: expected hamburger is missing (see screenshot “no-hamburger-menu.png”).
3) Confirm the menu cannot be opened (no visible toggle).

Expected
- A visible hamburger icon (three white horizontal bars) on the header’s right side.
- Clicking it toggles the menu panel open/closed.

Observed
- No hamburger visible. Header shows, widgets render beneath; user cannot access the menu.

Hypotheses (from most general to most specific)
1) Z-index/stacking context overlap (Strong)
   - GridStack items or overlays (.rt-body overlays: #iconOverlay with z-index: 1000; widget headers with z-index: 2500) may overlap the header. If header isn’t elevated, the hamburger could be visually covered on the right edge.
2) Header not sticky or positioned, allowing grid content to scroll under it (Strong)
   - Without `position: sticky`/`relative` + high z-index, the grid (or absolutely positioned elements) might cover the header area.
3) Hamburger DOM present but invisible due to CSS specificity or resets (Moderate)
   - `.menu-toggle .bar` styles might be overridden by a global `.bar` rule (from browser/other CSS), setting width/height or background to 0/transparent.
4) Color/contrast issue (Weak)
   - Bars are white on a white/transparent background if header background not applied or in a dark overlay area; bars become effectively invisible.
5) Rendering in FileMaker Web Viewer safe-area overlap (Weak)
   - A browser/OS chrome region or Web Viewer inset could truncate the button visually; needs verification with standard browser.

Null Hypotheses (likely not the cause)
- HTML not present: index.html includes header and menu button; if DOM inspection shows #menu-toggle exists, it’s not a missing markup issue.
- CSS not loaded: other header/web app styles clearly render; so stylesheets are loading.

Investigation checklist
- DOM:
  - Verify #menu-toggle exists and has three span.bar children.
  - Toggle a temporary outline: `#menu-toggle { outline: 1px solid red !important; }` to see if it’s covered/visible.
- Z-index:
  - Inspect computed stacking context for `.app-header` vs. `.grid-stack-item`, `.rt-body`, `#iconOverlay`.
  - Temporarily add: `.app-header { position: sticky; top: 0; z-index: 6000; }` and re-check.
- Overlap:
  - Use `document.elementFromPoint(window.innerWidth-10, 10)` to see which element sits above the right corner.
- CSS specificity:
  - Check if any `.bar` rule exists elsewhere with `display:none`, `height:0`, or `background:transparent`.
  - Verify final computed styles for `.menu-toggle .bar` width/height/background.
- FileMaker Web Viewer:
  - Test in a regular browser tab to exclude Web Viewer quirks.

Proposed fix path (ordered)
1) Ensure header stays above grid content:
   - Add sticky positioning and high z-index to `.app-header`.
   - Confirm `.workspace` height calculation still honors header height.
2) Guard against overlap from overlays:
   - Ensure `#iconOverlay` and widget headers never exceed header’s z-index.
3) Harden hamburger visibility:
   - Increase bar height to 3px and spacing if needed for clarity.
   - Add `pointer-events: auto` to `.menu-toggle`.
4) Verify no conflicting `.bar` rules;
   - If conflicts exist, scope to `.app-header .menu-toggle .bar`.

Acceptance criteria
- Hamburger icon is visible on the header’s right side in both browser and FileMaker Web Viewer.
- Clicking the hamburger opens/closes the menu panel.
- Realtime widget overlays and GridStack items never overlap the header.

Notes
- If we previously added sticky/z-index then reverted, re-introduce them with minimal impact and verify across both environments.
- Keep the header as a top-level stacking context so GridStack content cannot cover it.
