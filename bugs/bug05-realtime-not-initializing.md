# Bug 05 — Realtime does not initialize on first load

Status: Open
Priority: High
Owner: Web

Environment
- Web Viewer app (GridStack UI)
- FileMaker Grid layout scripts not yet implemented (Grid_LoadLayout, etc.)

Symptoms
- On initial page load, the Voice/Reatime widget does not appear and Realtime_Init is not called.
- Toggling Voice has no effect until widgets are manually synced later.

Steps to Reproduce
1. Launch the app with no persisted layout and with FileMaker grid scripts not yet wired.
2. Load the page; observe that the Voice widget is not added and Realtime does not initialize.
3. No explicit error appears in console.

Expected
- On first load, if no saved layout is available (or FM scripts are not yet implemented), the UI should fall back to defaults and mount widgets per menu toggles (Voice on by default), calling ensureRealtimeReady to initialize Realtime.

Actual
- loadLayoutForCurrentMode() calls FileMaker.PerformScript('Grid_LoadLayout', ...) and returns true immediately.
- The DOMContentLoaded flow interprets “true” as “layout handled,” skips the default fallback (syncWidgets), so the Voice widget is never mounted and Realtime never initializes.

Root Cause
- With FM Grid_LoadLayout not implemented yet, returning true from loadLayoutForCurrentMode() blocks the default mounting path, leaving the grid empty.

Fix
- Change loadLayoutForCurrentMode() to return false immediately after requesting FileMaker to load the layout. This allows the fallback path to run (syncWidgets), mounting the Voice widget and triggering Realtime initialization. When FM later returns a layout via applyLoadedLayout(...), the grid will rebuild correctly.

Validation
- Reload app: Voice widget should appear and Realtime should request/init token.
- After FM scripts are implemented, applyLoadedLayout(...) should still rebuild the grid when the response arrives.

Related
- src/index.js: loadLayoutForCurrentMode() return value after PerformScript
- No changes needed to ensureRealtimeReady/applyRealtimeInit
