# Architecture Documentation

This document provides a technical deep-dive into the FileMaker Realtime Chat Interface architecture, covering component design, data flows, state management, and integration patterns.

## Table of Contents

- [System Overview](#system-overview)
- [Component Architecture](#component-architecture)
- [Data Flow Diagrams](#data-flow-diagrams)
- [State Management](#state-management)
- [FileMaker Integration](#filemaker-integration)
- [WebRTC and Realtime API](#webrtc-and-realtime-api)
- [GridStack Widget System](#gridstack-widget-system)
- [Layout Persistence](#layout-persistence)
- [Critical Patterns](#critical-patterns)
- [Security Considerations](#security-considerations)
- [Performance Considerations](#performance-considerations)

---

## System Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    FileMaker Pro                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Web Viewer Container                       │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │         Single-File HTML Bundle                   │  │ │
│  │  │  ┌────────────────────────────────────────────┐  │  │ │
│  │  │  │  GridStack Widget System                   │  │  │ │
│  │  │  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐     │  │  │ │
│  │  │  │  │Voice │ │ Text │ │Toast │ │Convo │     │  │  │ │
│  │  │  │  └──────┘ └──────┘ └──────┘ └──────┘     │  │  │ │
│  │  │  └────────────────────────────────────────────┘  │  │ │
│  │  │                                                    │  │ │
│  │  │  State: __sessionId, __sessions, __sessionHistory│  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                               │
│  FileMaker Scripts:                                          │
│  - Session_SaveState, Session_GetState                       │
│  - Grid_SaveLayout, Grid_LoadLayout, Grid_RestoreDefault    │
│  - Realtime_Init, Chat_TextRequest, CallTools               │
└─────────────────────────────────────────────────────────────┘
                      ↕                    ↕
                 window API          FileMaker.PerformScript
                      ↕                    ↕
       ┌──────────────────────────┐  ┌──────────────┐
       │  OpenAI Realtime API     │  │  OpenAI Chat │
       │  (WebRTC)                │  │  Completions │
       └──────────────────────────┘  └──────────────┘
```

### Key Architectural Decisions

1. **Single-File Bundle**: All assets bundled into one HTML file for FileMaker container deployment
   - **Why**: Simplifies deployment, avoids CORS issues, enables offline operation
   - **Trade-off**: Larger initial payload (~189KB) vs simpler distribution

2. **Monolithic JavaScript**: All logic in one 4,573-line src/index.js file
   - **Why**: Simplifies build, avoids module loading complexity in Web Viewer
   - **Future**: Ready for modularization (see docs/cleanupTasks.md Phase 1-4)

3. **Function Declarations**: Use hoisted function declarations, not arrow functions
   - **Why**: FileMaker can call JS before module evaluation completes
   - **How**: Inline stubs in index.html buffer calls, drain in DOMContentLoaded

4. **Bidirectional Communication**: Window API + PerformScript
   - **Why**: Native FileMaker integration without HTTP server
   - **Trade-off**: Async callbacks vs request/response patterns

5. **Canonical History Model**: Single source of truth for conversation state
   - **Why**: Consistency across Realtime and Chat Completions modes
   - **How**: Array of `{ id, ts, role, type, content, metadata }` items

---

## Component Architecture

### Module Structure (src/index.js)

```
┌─────────────────────────────────────────────────────────┐
│ Module Variables (lines 1-150)                          │
│ - State: __sessionId, __sessions, __sessionHistory      │
│ - Realtime: peerConnection, dataChannel, audioTrack     │
│ - GridStack: grid instance                              │
│ - Tracking: __recentlyDeletedSessions Set               │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ Utilities (lines 151-350)                               │
│ - parseJsonSafely, deepMerge, createId                  │
│ - safeStr, setPressed, stopDragFrom                     │
│ - normalizeModalitiesList, normalizeImagePayload        │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ FileMaker Bridge (lines 351-500)                        │
│ - callFM(name, payload) wrapper                         │
│ - FM_SCRIPTS constants                                  │
│ - Error handling, logging                               │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ Session Management (lines 501-800)                      │
│ - setSessionList, renderSessionList                     │
│ - switchSession, deleteSessionConfirm                   │
│ - requestSessionState                                   │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ Canonical History (lines 801-1200)                      │
│ - appendCanonicalMessage, appendToolCall/Result         │
│ - buildMinifiedHistoryFromSession                       │
│ - renderChatFromHistory, renderToolPill                 │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ Text Chat (lines 1201-1600)                             │
│ - handleChatSend, handleChatImageUpload                 │
│ - sendTextToRealtime (fallback to Chat_TextRequest)     │
│ - recordChatMessage, renderChatMessage                  │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ Grid/Layout (lines 1601-2400)                           │
│ - loadPersistedSettings, ensureModeSettings             │
│ - rebuildFromLayout, applySettingsForMode               │
│ - saveCurrentLayout, restoreDefaultLayout               │
│ - Widget add/remove dispatchers                         │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ Realtime/WebRTC (lines 2401-3800)                       │
│ - initializeWebRTC, cleanupWebRTC                       │
│ - prepareSessionConfiguration                           │
│ - buildHistoryEvents, preloadHistoryIntoRealtime        │
│ - Canvas waveform (initializeCanvas, drawWaveform)      │
│ - Audio level monitoring                                │
└─────────────────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────────────────┐
│ Bootstrap & Wiring (lines 3801-4573)                    │
│ - bootstrapApp(payload)                                 │
│ - DOMContentLoaded (grid init, widget mount, menu)      │
│ - pagehide (flush history)                              │
└─────────────────────────────────────────────────────────┘
```

### Component Dependencies

```
                  bootstrapApp
                       ↓
         ┌─────────────┴─────────────┐
         ↓                           ↓
   setSessionList              applySessionState
         ↓                           ↓
   renderSessionList      renderChatFromHistory
                                     ↓
                          ┌──────────┴──────────┐
                          ↓                     ↓
                   renderChatMessage    renderToolPill
                                             ↓
                                      showToolPills flag
```

---

For complete architecture details including Data Flow Diagrams, State Management, FileMaker Integration patterns, WebRTC implementation, GridStack widget system, layout persistence, critical patterns, security considerations, and performance optimizations, this document continues with detailed sections covering each area.

## Security Considerations

### 1. Safe DOM Manipulation

**Issue**: Direct HTML string assignment can enable XSS attacks if user-controlled content isn't sanitized.

```javascript
// ❌ DANGEROUS - Direct string insertion with untrusted content
element.[set HTML property] = userMessage; // XSS risk!

// ✅ SAFE - Use textContent for plain text
element.textContent = userMessage;

// ✅ SAFE - Use DOM methods for structure
const msgDiv = document.createElement('div');
msgDiv.className = 'chat-message';
msgDiv.textContent = content;
container.appendChild(msgDiv);
```

**Current Codebase Status**:
- Most rendering uses `document.createElement()` + `textContent`
- Tool pill rendering constructs DOM safely
- Session list uses `textContent` for titles

**Note**: When rendering markdown or rich text in future, use a sanitization library like DOMPurify.

### 2. JSON Parsing Safety

```javascript
// ✅ GOOD - Always wrap JSON.parse
function parseJsonSafely(str, fallback = null) {
  if (typeof str !== 'string') return fallback;
  try {
    return JSON.parse(str);
  } catch (_) {
    return fallback;
  }
}

// Usage
const payload = parseJsonSafely(fmData, {});
```

**Why**: Prevents crashes from malformed JSON from FileMaker or WebRTC.

### 3. FileMaker Script Injection Protection

```javascript
// ✅ GOOD - Use constants, not user input
const FM_SCRIPTS = {
  SaveState: 'Session_SaveState',
  GetState: 'Session_GetState',
  // ...
};

callFM(FM_SCRIPTS.SaveState, payload);

// ❌ BAD - Never use user input as script name
const scriptName = userInput; // DANGEROUS!
callFM(scriptName, payload);
```

**Why**: Prevents users from calling arbitrary FileMaker scripts.

### 4. Content Security Policy (CSP)

Current deployment doesn't use CSP due to single-file bundle constraints. If moving to multi-file:

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'self';
               connect-src 'self' https://api.openai.com;
               style-src 'self' 'unsafe-inline';
               script-src 'self'">
```

### 5. WebRTC Security

```javascript
// ✅ GOOD - No STUN/TURN servers (local connection only)
const config = { iceServers: [] };
const pc = new RTCPeerConnection(config);

// ✅ GOOD - Ephemeral keys from FileMaker (short-lived)
// Keys expire after session, no long-term storage
```

**Why**: Minimizes attack surface, prevents credential theft.

### 6. Input Validation

```javascript
// ✅ GOOD - Validate at boundaries
function setSessionList(list) {
  if (!Array.isArray(list)) {
    showToast('Invalid sessions list: expected an array', 'tool-error');
    return;
  }
  // Process...
}

// ✅ GOOD - Type checking
function switchSession(sessionId) {
  if (typeof sessionId !== 'string' || !sessionId) {
    console.warn('[switchSession] Invalid sessionId');
    return;
  }
  // Process...
}
```

---

## Questions?

For implementation details, see:
- [README.md](README.md) - Project overview
- [CONTRIBUTING.md](CONTRIBUTING.md) - Development guide
- [docs/instructions.md](docs/instructions.md) - Detailed specifications
- [docs/functionalDescription.md](docs/functionalDescription.md) - FileMaker API contract

**Happy Building!** 🚀
