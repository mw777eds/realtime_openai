# Bug 06 — Bootstrap callback race causes “ReferenceError: Can't find variable: bootstrapApp”

Status: Open
Severity: High (breaks initial load; Realtime never initializes)
First seen after commits:
- 90208c0 “fix: defer Realtime init until after bootstrap to avoid double-init”
- 342def3 “fix: add early window stubs and apply pending FM callbacks”

Environment
- FileMaker Web Viewer (WKWebView/Safari)
- index.html loads src/index.js as type="module"
- FileMaker script calls applySessionState/bootstrapApp early during viewer load

Summary
On first load, a console error appears:
ReferenceError: Can't find variable: bootstrapApp (Global Code, localhost:1)
This indicates FileMaker is invoking window.bootstrapApp (or applySessionState) before the module script (src/index.js) has executed and defined those functions.

Root cause hypothesis
- With type="module", the browser defers evaluating the module until after HTML parsing. FileMaker’s “Perform JavaScript in Web Viewer” can run before the module executes.
- Our “early stubs” for bootstrapApp/applySessionState/applyRealtimeInit are defined at the top of src/index.js, but they still don’t exist until the module is evaluated.
- Result: FM calls happen before any JS is present; hence ReferenceError.

What changed recently
- We deferred ensureRealtimeReady until after bootstrap, reducing double-init. This made timing more sensitive: we now rely on bootstrap arriving and being applied before starting Realtime.
- We added stubs inside the module file, which is too late if FM calls arrive before the module loads.

Expected
- No ReferenceError during initial load.
- Any FM callback (applySessionState/bootstrapApp/applyRealtimeInit) arriving before module load should be buffered and applied once the module is ready.
- Realtime should initialize once after bootstrap applies, not before.

Proposed fix
Option A (preferred, JS-only):
- Add a tiny inline non-module script tag in index.html before the module import that:
  - Defines window.__pendingBootstrapPayload and window.__pendingRealtimeInitPayload
  - Defines global stubs window.bootstrapApp, window.applySessionState, and window.applyRealtimeInit that buffer payloads into those variables
  - Sets a readiness flag window.__bootstrapStubsReady = true
- Keep the drain logic in src/index.js (DOMContentLoaded) to consume and clear pending payloads.
- Remove the module-level stub definitions from src/index.js to avoid overwriting the inline stubs.

Option B (FM script change):
- Gate FM calls until the viewer is ready:
  - Wait for document.readyState === 'complete' OR wait for a JS flag (window.__bootstrapReady === true) before calling bootstrapApp/applySessionState/applyRealtimeInit.
- This also works but requires FileMaker script changes; Option A avoids that.

Risks and mitigations
- Duplicated stubs: ensure only index.html contains stubs; the module should only drain them.
- Multiple callbacks: draining logic should handle both payloads idempotently (clear vars after applying).
- Ensure __rtState and __bootstrapDone gating remain in place to avoid duplicate Realtime_Init.

Acceptance criteria
- No “ReferenceError: bootstrapApp” on fresh load.
- Single call to Realtime_Init per initial load (verify via console logs).
- If FM calls bootstrap before module loads, payload is buffered and later applied automatically.
- Switching sessions still respects mute state and no duplicate Realtime init.
- Works in both dev (Vite) and FileMaker Web Viewer.

Debugging tips
- Add console logs in the inline stub to confirm early FM calls:
  - console.log('[stub] bootstrapApp called early');
- Add logs around ensureRealtimeReady and applyRealtimeInit to confirm single initialization.
- Check window.__bootstrapDone and __rtState transitions.

Implementation plan
1) index.html (before the type="module" import):
   <script>
     (function(){
       window.__pendingBootstrapPayload = window.__pendingBootstrapPayload || null;
       window.__pendingRealtimeInitPayload = window.__pendingRealtimeInitPayload || null;
       if (typeof window.bootstrapApp !== 'function') {
         window.bootstrapApp = function(payload){ window.__pendingBootstrapPayload = payload; };
       }
       if (typeof window.applySessionState !== 'function') {
         window.applySessionState = function(payload){ window.__pendingBootstrapPayload = payload; };
       }
       if (typeof window.applyRealtimeInit !== 'function') {
         window.applyRealtimeInit = function(payload){ window.__pendingRealtimeInitPayload = payload; };
       }
       window.__bootstrapStubsReady = true;
     })();
   </script>

2) src/index.js:
   - Remove the module-level early stubs block.
   - Keep the existing DOMContentLoaded “drain pending payloads” logic:
     - If window.__pendingBootstrapPayload, call bootstrapApp() and clear.
     - If window.__pendingRealtimeInitPayload, call applyRealtimeInit() and clear.

Workaround (until fixed)
- Delay FM’s first callback until after the viewer signals readiness (e.g., poll for window.__bootstrapStubsReady or use a small delay).
- Reloading sometimes races differently, but not reliable.

Related issues
- Double init avoided by commit 90208c0. This bug is a separate earlier-callback race.
