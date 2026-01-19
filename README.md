# FileMaker Realtime Chat Interface

A sophisticated voice + text chat interface for FileMaker, powered by OpenAI's Realtime API and Chat Completions API. Features a flexible grid-based widget layout for conversations, voice interaction, text chat, and activity toasts.

## ✨ Key Features

**Voice Interaction:**
- WebRTC-based real-time voice chat via OpenAI Realtime API
- Audio waveform visualization with level monitoring
- Click-to-mute with visual feedback (sleep icon)
- Server-side voice activity detection (VAD)

**Text Chat:**
- Parallel text chat using Chat Completions API
- Image upload support (container images to vision context)
- Tool call/result visualization with JSON inspection
- Message history persistence

**Flexible Layout:**
- GridStack-based draggable/resizable widgets
- Four widget types: Voice, Text, Toasts, Conversations
- Per-session layout persistence
- Docked/undocked conversations sidebar

**Session Management:**
- Multiple concurrent sessions
- Quick session switching
- Inline session renaming
- Session search/filter

## 🏗️ Architecture

**Deployment:** Single-file HTML bundle deployed to FileMaker container field
**Build:** Vite 6 with single-file plugin → `dist/index.html` (~189KB)
**Grid:** GridStack 12.3.3 for widget management
**Integration:** Bidirectional communication via FileMaker scripts

### FileMaker Integration Points

**JavaScript → FileMaker Scripts:**
- `Session_SaveState` - Persist session history/settings/layout
- `Session_GetState` - Load session data
- `CallTools` - Execute tool calls
- `Realtime_Init` - Get ephemeral key & config
- `Chat_TextRequest` - Submit text messages

**FileMaker → JavaScript Functions:**
- `window.bootstrapApp(payload)` - Initialize with session data
- `window.initializeWebRTC(...)` - Start Realtime connection
- `window.sendToolResponse(result)` - Return tool call results
- `window.setSessionList(sessions)` - Update session list

## 📋 Requirements

- FileMaker Pro (Web Viewer with WebKit/Chrome support)
- OpenAI API key (Realtime + Chat Completions access)
- HTTPS development environment for WebRTC (localhost:1234)
- Self-signed SSL certificates for local dev

## 🚀 Development Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Generate SSL Certificates (required for WebRTC)
```bash
cd ..
openssl req -x509 -newkey rsa:2048 -keyout localhost-key.pem \
  -out localhost-cert.pem -days 365 -nodes -subj "/CN=localhost"
cd realtime
```

### 3. Start Development Server
```bash
npm start
# Opens https://localhost:1234
```

### 4. Deploy to FileMaker
```bash
npm run deploy-to-fm
# Builds and uploads to FileMaker via FMP:// protocol
```

### Configuration
Edit `widget.config.cjs` to set your FileMaker file and upload script:
```javascript
module.exports = {
  widgetName: 'realtime',
  fmServer: '$',                    // Local/embedded
  fmFile: 'Empowered_Documenter',
  uploadScript: 'UploadToHTML'
};
```

## 📁 Project Structure

```
realtime/
├── index.html              # Entry point with bootstrap stubs
├── src/
│   ├── index.js           # Main application (4,573 lines)
│   ├── icons.js           # SVG path definitions
│   ├── style.css          # Styling (724 lines)
│   └── md5.js             # MD5 hashing for layout tracking
├── scripts/
│   ├── upload.cjs         # FileMaker deployment
│   ├── generate-script-steps.js  # FM script generator
│   └── start-fm-dev.js    # Launch FileMaker dev environment
├── docs/
│   ├── instructions.md           # Comprehensive requirements
│   ├── functionalDescription.md  # Feature overview
│   ├── bootstrap-init-flow.txt   # Initialization sequence
│   └── cleanupTasks.md           # Refactoring checklist
├── bugs/
│   ├── on-hold/           # Deferred issues
│   ├── resolved/          # Completed bug fixes
│   └── bugxx-template.md  # Bug report template
├── dist/                  # Build output (git-ignored)
├── vite.config.js         # Build configuration
└── widget.config.cjs      # FileMaker widget metadata
```

## 🧪 Testing

**Manual Test Checklist:**
See `docs/cleanupTasks.md` for comprehensive test scenarios:
- Voice/text widget toggle
- Session switching with layout persistence
- Dock/undock conversations
- Tool call visualization
- Mute/unmute functionality

**Automated Tests:** Not yet implemented (planned)

## 📚 Additional Documentation

- **[CONTRIBUTING.md](CONTRIBUTING.md)** - Development guide and workflow
- **[ARCHITECTURE.md](ARCHITECTURE.md)** - Technical architecture details
- **[docs/instructions.md](docs/instructions.md)** - Detailed requirements & specifications
- **[docs/functionalDescription.md](docs/functionalDescription.md)** - Feature descriptions
- **[docs/bootstrap-init-flow.txt](docs/bootstrap-init-flow.txt)** - Bootstrap sequence
- **[docs/cleanupTasks.md](docs/cleanupTasks.md)** - Refactoring tasks

## 🐛 Known Issues

See `bugs/on-hold/` for deferred issues.
All major bugs (bugs 1-8) have been resolved and archived to `bugs/resolved/`.

## 🤝 Contributing

1. Create a feature branch from `adding-chat-and-artifacts`
2. Make changes with clear commit messages
3. Test thoroughly (use manual checklist)
4. Submit PR with detailed description

**Code Style:**
- ES modules (no TypeScript)
- Function declarations for hoisting
- Preserve FileMaker window API
- Follow existing patterns

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## 📄 License

MIT License

## 🙏 Acknowledgments

Built with:
- OpenAI Realtime API & Chat Completions API
- GridStack (grid layout)
- Vite (build tool)
- FileMaker Pro (container deployment)

---

**Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>**
