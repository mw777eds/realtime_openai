# Contributing to FileMaker Realtime Chat Interface

Thank you for your interest in contributing! This guide will help you understand the project structure, development workflow, and coding conventions.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Development Workflow](#development-workflow)
- [Code Style Guidelines](#code-style-guidelines)
- [Testing](#testing)
- [Commit Message Format](#commit-message-format)
- [Pull Request Process](#pull-request-process)
- [Common Patterns](#common-patterns)

## Development Setup

### Prerequisites

- Node.js 18+ (for Vite 6)
- FileMaker Pro with Web Viewer support
- OpenAI API key (Realtime + Chat Completions access)
- macOS/Linux with OpenSSL installed

### Initial Setup

1. **Clone and Install**
   ```bash
   git clone <repository-url>
   cd realtime
   npm install
   ```

2. **Generate SSL Certificates** (required for WebRTC)
   ```bash
   cd ..
   openssl req -x509 -newkey rsa:2048 -keyout localhost-key.pem \
     -out localhost-cert.pem -days 365 -nodes -subj "/CN=localhost"
   cd realtime
   ```

3. **Configure FileMaker Upload**

   Edit `widget.config.cjs`:
   ```javascript
   module.exports = {
     widgetName: 'realtime',
     fmServer: '$',                    // Local/embedded
     fmFile: 'YourFileName',           // Without .fmp12 extension
     uploadScript: 'UploadToHTML'
   };
   ```

4. **Start Development Server**
   ```bash
   npm start
   # Opens https://localhost:1234
   # Accept self-signed certificate in browser
   ```

### Available Commands

```bash
npm start              # Start dev server with HMR (https://localhost:1234)
npm run build          # Build production bundle to dist/index.html
npm run deploy-to-fm   # Build and upload to FileMaker via FMP:// protocol
npm run preview        # Preview production build locally
```

## Project Architecture

### File Structure

```
realtime/
├── index.html              # Entry point with bootstrap stubs
├── src/
│   ├── index.js           # Main application (4,573 lines)
│   ├── icons.js           # SVG path definitions (embedded)
│   ├── style.css          # Styling (724 lines)
│   └── md5.js             # MD5 hashing for layout tracking
├── scripts/
│   ├── upload.cjs         # FileMaker deployment
│   └── start-fm-dev.js    # Launch FileMaker dev environment
├── docs/                  # Comprehensive documentation
├── bugs/                  # Bug tracking (resolved/, on-hold/)
└── vite.config.js         # Build configuration
```

### Key Architectural Concepts

1. **Single-File Bundle**: Vite builds everything into `dist/index.html` (~189KB) for FileMaker container field deployment

2. **Bootstrap Sequence**: Inline stubs in `index.html` buffer FileMaker callbacks before modules load
   ```javascript
   // index.html stubs
   window.bootstrapApp = (payload) => { window.__pendingBootstrap = payload; }
   window.applySessionState = (payload) => { /* buffer */ }
   window.applyRealtimeInit = (payload) => { /* buffer */ }

   // src/index.js drains buffers in DOMContentLoaded
   ```

3. **Canonical History Model**: Single source of truth for conversation history
   - Format: `[{ id, ts, role, type, content, metadata }]`
   - Synced bidirectionally with FileMaker
   - Supports both Realtime API and Chat Completions API

4. **Widget System**: GridStack 12.3.3 manages four widget types
   - Voice (Realtime): WebRTC waveform, mic toggle
   - Text: Chat messages, input, image upload
   - Toasts: Activity notifications
   - Conversations: Session list (dockable sidebar)

5. **Layout Persistence**: Per-mode (docked/undocked) layouts cached in:
   - localStorage (fast reads)
   - FileMaker (persistent storage)
   - MD5 hashing prevents redundant saves

6. **FileMaker Integration**: Bidirectional communication
   - **JS → FM**: `window.FileMaker.PerformScript()` via `callFM()` wrapper
   - **FM → JS**: "Perform JavaScript in Web Viewer" calls `window.*` functions

## Development Workflow

### Feature Development

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Edit `src/index.js` for logic changes
   - Edit `src/style.css` for styling
   - Add SVG icons to `src/icons.js` if needed
   - Update documentation as needed

3. **Test Locally**
   - Run `npm start` for live development
   - Test in both browser and FileMaker Web Viewer
   - Verify all widgets function correctly
   - Check manual test checklist (see [Testing](#testing))

4. **Build and Deploy**
   ```bash
   npm run deploy-to-fm
   ```

5. **Commit Changes** (see [Commit Message Format](#commit-message-format))

### Bug Fixes

1. **Create Bug Report** (if needed)
   - Use `bugs/bugxx-template.md`
   - Document steps to reproduce, expected vs actual behavior
   - Include environment details

2. **Fix and Test**
   - Make minimal changes to fix the issue
   - Test thoroughly to avoid regressions
   - Update bug report with resolution details

3. **Move to Resolved**
   ```bash
   git mv bugs/bugXX-description.md bugs/resolved/
   ```

## Code Style Guidelines

### General Principles

- **ES Modules**: Use ES module syntax (no TypeScript, no CommonJS in src/)
- **Function Declarations**: Prefer `function foo() {}` over `const foo = () => {}` for hoisting
- **No Over-Engineering**: Make only the changes requested; avoid premature abstractions
- **Preserve Patterns**: Follow existing code patterns for consistency

### JavaScript Conventions

#### 1. Function Declarations (Required)

```javascript
// ✅ GOOD - Hoisting allows FM callbacks before definition
function bootstrapApp(payload) {
  // Implementation
}

// ❌ BAD - Not hoisted, FM early calls will fail
const bootstrapApp = (payload) => {
  // Implementation
};
```

#### 2. Window API Exports

```javascript
// ✅ GOOD - Available immediately for FileMaker
window.bootstrapApp = bootstrapApp;
window.applySessionState = applySessionState;
window.setSessionList = setSessionList;

// ❌ BAD - Don't move inside DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
  window.bootstrapApp = bootstrapApp; // Too late!
});
```

#### 3. FileMaker Bridge Calls

```javascript
// ✅ GOOD - Use callFM wrapper with constants
const FM_SCRIPTS = {
  SaveState: 'Session_SaveState',
  GetState: 'Session_GetState',
  RealtimeInit: 'Realtime_Init',
  // ...
};

function saveSession(options) {
  const payload = buildSessionSettingsBundle(options);
  callFM(FM_SCRIPTS.SaveState, payload);
}

// ❌ BAD - Direct PerformScript calls, magic strings
window.FileMaker.PerformScript('Session_SaveState', JSON.stringify(payload));
```

#### 4. State Management

```javascript
// Module-level state (prefixed with __)
let __sessionId = null;
let __sessions = [];
let __recentlyDeletedSessions = new Set();

// Global state on window (for FM access)
window.__historyPreloadedFor = null;
window.__rtState = 'idle'; // 'idle' | 'connecting' | 'ready'
```

#### 5. Error Handling

```javascript
// ✅ GOOD - Try/catch around external integrations
function callFM(name, payload) {
  const data = (typeof payload === 'object')
    ? JSON.stringify(payload)
    : String(payload);

  try {
    window.FileMaker.PerformScript(name, data);
  } catch (err) {
    console.error('[callFM error]', name, err);
  }
}

// ✅ GOOD - Validate inputs at boundaries
function setSessionList(list) {
  if (!Array.isArray(list)) {
    showToast('Invalid sessions list: expected an array', 'tool-error');
    return;
  }
  // Process list...
}
```

#### 6. DOM Manipulation

```javascript
// ✅ GOOD - Cache DOM queries
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// ❌ BAD - Repeated queries
document.getElementById('send-btn').addEventListener('click', () => {
  const text = document.getElementById('chat-input').value;
});
```

### CSS Conventions

```css
/* Use BEM-like naming for components */
.widget-voice {}
.widget-voice__canvas {}
.widget-voice__controls {}
.widget-voice__button--muted {}

/* Use CSS custom properties for theming */
:root {
  --bg-primary: #1a1a1a;
  --text-primary: #ffffff;
  --accent-color: #007bff;
}

/* Keep specificity low, avoid !important */
```

### FileMaker Integration Patterns

#### Pattern 1: Optimistic UI Updates

```javascript
async function deleteSessionConfirm(sessionId) {
  // 1. Get user confirmation
  const ok = await showConfirmModal(`Delete "${title}"?`);
  if (!ok) return false;

  // 2. Update UI immediately (optimistic)
  window.__sessions = window.__sessions.filter(s => s.id !== sessionId);
  renderSessionList();

  // 3. Track deletion to filter stale FM responses
  __recentlyDeletedSessions.add(sessionId);
  setTimeout(() => __recentlyDeletedSessions.delete(sessionId), 5000);

  // 4. Request server update
  requestSessionState('next');
  return true;
}
```

#### Pattern 2: History-Only Fast Path

```javascript
function applySessionState(payload) {
  // Fast path: if only history provided, update UI without FM callbacks
  const isHistoryOnly = payload.history &&
    !payload.settings &&
    !payload.layout &&
    !payload.sessionId;

  if (isHistoryOnly) {
    window.__sessionHistory = payload.history;
    renderChatFromHistory();
    return;
  }

  // Full path: merge all state
  if (payload.sessionId) window.__sessionId = payload.sessionId;
  if (payload.history) window.__sessionHistory = payload.history;
  // ...
}
```

#### Pattern 3: WebRTC Cleanup

```javascript
function cleanupWebRTC() {
  // 1. Clear intervals
  if (audioLevelInterval) {
    clearInterval(audioLevelInterval);
    audioLevelInterval = null;
  }

  // 2. Stop tracks
  if (audioTrack) {
    audioTrack.stop();
    audioTrack = null;
  }

  // 3. Close connections
  if (dataChannel) {
    dataChannel.close();
    dataChannel = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }

  // 4. Reset state flags
  window.__rtState = 'idle';
  window.__historyPreloadedFor = null;

  // 5. Flush to FileMaker
  saveSession({ history: true });
}
```

## Testing

### Manual Test Checklist

See `docs/cleanupTasks.md` (lines 117-124) for comprehensive test scenarios:

- [ ] Text send while Realtime disconnected triggers `Chat_TextRequest` with `{ prompt }` and renders user bubble
- [ ] Realtime start preloads history; speaking shows waveform; muting cancels response and shows sleep icon
- [ ] Toggling Voice/Text/Toasts adds/removes widgets and persists positions in localStorage
- [ ] Dock/Undock toggles sidebar/widget correctly and preserves layout per mode
- [ ] Tool calls render tool pills when enabled; JSON modal opens and closes
- [ ] No console errors on reload; bootstrap payload renders sessions and history
- [ ] Session switching preserves layout per session
- [ ] Session deletion updates list immediately and prevents stale sessions from reappearing

### Browser Testing

Test in these environments:
1. **Chrome/Edge** (localhost:1234) - Primary development
2. **Safari** (localhost:1234) - WebKit engine (matches FileMaker on macOS)
3. **FileMaker Web Viewer** (deployed) - Production environment

### Console Debugging

Enable debug logging by setting in browser console:
```javascript
window.__debugTrace = true;
```

Look for these log patterns:
```
[applySessionState] { sessionId, history, settings, layout }
[callFM] SaveState { sessionId, history: [...] }
[WebRTC] Channel opened, state: ready
```

## Commit Message Format

Use conventional commits format:

```
<type>(<scope>): <subject>

<body>

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructuring without behavior change
- `docs`: Documentation changes
- `style`: Formatting, whitespace
- `chore`: Build config, dependencies
- `test`: Test additions or corrections

### Scopes

- `widgets`: GridStack widget system
- `realtime`: WebRTC/Realtime API integration
- `chat`: Text chat functionality
- `session`: Session management
- `fm-bridge`: FileMaker integration
- `layout`: Grid layout and persistence
- `ui`: User interface components
- `build`: Build configuration

### Examples

```
feat(session): add optimistic deletion with stale-data filtering

- Track deleted sessions in Set for 5 seconds
- Filter them from setSessionList() to prevent race condition
- Add session title to delete confirmation modal

Fixes issue where deleted sessions reappeared when FileMaker
returned stale data before deletion processed.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

```
refactor(fm-bridge): consolidate script calls with callFM wrapper

- Add FM_SCRIPTS constants object
- Replace direct PerformScript calls with callFM()
- Add try/catch error handling

No behavior change.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
```

## Pull Request Process

### Before Creating PR

1. **Test Thoroughly**
   - Run through manual test checklist
   - Test in FileMaker Web Viewer (not just browser)
   - Check for console errors
   - Verify no regressions

2. **Update Documentation**
   - Update README.md if architecture changed
   - Update docs/instructions.md if FileMaker API changed
   - Add comments for complex logic

3. **Clean Commit History**
   - Squash WIP commits if needed
   - Ensure commit messages follow format
   - Add Co-Authored-By tag

### Creating PR

1. **Push Feature Branch**
   ```bash
   git push origin feature/your-feature-name
   ```

2. **Create PR on GitHub**
   - Base: `adding-chat-and-artifacts` (current development branch)
   - Title: Clear, concise description
   - Description: Use template below

### PR Description Template

```markdown
## Summary
Brief description of changes and motivation.

## Changes
- Bullet list of specific changes
- Include files modified
- Mention any breaking changes

## Testing
- [ ] Tested in Chrome/Edge (localhost:1234)
- [ ] Tested in Safari (WebKit)
- [ ] Tested in FileMaker Web Viewer
- [ ] Manual test checklist passed
- [ ] No console errors

## Screenshots (if UI changes)
[Add screenshots or screen recordings]

## Related Issues
Fixes #XX
Closes bugs/bugXX-description.md

## Checklist
- [ ] Code follows style guidelines
- [ ] Documentation updated
- [ ] Commit messages follow format
- [ ] No debug code left in
```

### Code Review

Expect feedback on:
- Code style and patterns
- FileMaker integration correctness
- Edge cases and error handling
- Performance implications
- Documentation completeness

## Common Patterns

### Adding a New Widget

1. Add widget state to module variables
2. Create add/remove dispatcher entries
3. Add default position to `DEFAULT_POS`
4. Implement widget HTML generation
5. Add cleanup logic to remove function
6. Update `rebuildFromLayout` switch
7. Test docked/undocked modes

### Adding a New FileMaker Script Call

1. Add script name to `FM_SCRIPTS` object
2. Create wrapper function using `callFM()`
3. Define payload structure (documented in code)
4. Handle response in callback function
5. Update `docs/functionalDescription.md` API contract
6. Test with actual FileMaker script

### Handling WebRTC Events

1. Add event listener on data channel
2. Parse JSON message
3. Update canonical history (`sessionHistory`)
4. Update UI immediately
5. Set preload flag if needed
6. Don't call FileMaker during active session

### Debugging FileMaker Integration

```javascript
// Add temporary logging
function callFM(name, payload) {
  console.log('[callFM]', name, payload);
  const data = (typeof payload === 'object')
    ? JSON.stringify(payload)
    : String(payload);

  try {
    window.FileMaker.PerformScript(name, data);
  } catch (err) {
    console.error('[callFM error]', name, err);
  }
}
```

---

## Questions?

- Check [README.md](README.md) for project overview
- See [ARCHITECTURE.md](ARCHITECTURE.md) for technical deep-dive
- Read [docs/instructions.md](docs/instructions.md) for detailed specifications
- Review [docs/functionalDescription.md](docs/functionalDescription.md) for FileMaker API

**Happy Contributing!** 🎉
