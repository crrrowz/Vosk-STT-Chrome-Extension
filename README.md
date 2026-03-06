<div align="center">

# 🎙️ Vosk STT — Chrome Extension

**Real-time Speech-to-Text directly into any input field**

[![License: MIT](https://img.shields.io/badge/License-MIT-6C3CE1.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-4F8FFF.svg)]()
[![Manifest](https://img.shields.io/badge/Manifest-V3-green.svg)]()
[![Website](https://img.shields.io/badge/Website-InnovaCode-blue.svg)](https://innovacode.org/en/projects/vosk-stt-chrome-extension)

<img src="assets/Gemini_Generated_Image_q3wwekq3wwekq3ww.png" width="800" alt="Vosk STT Extension" style="border-radius: 8px; margin-top: 20px;" />

<br/><br/>
</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎤 **Floating Mic Button** | Draggable FAB on any page — click to start/stop. Persists dragged position. |
| ⚡ **Split Quick Switch** | Optional split FAB to instantly swap between Arabic & English live |
| 📝 **Live Transcription** | See text appear in real-time as you speak |
| 🗣️ **Voice Commands** | Say "new line", "period", "comma", "نقطة", "سطر جديد" to format text |
| ↩️ **Editing Commands** | Say "delete", "undo" or "امسح" to remove last word; "clear" to empty field |
| 🌐 **Arabic + English** | Iraqi Arabic, Standard Arabic, English, and Mixed mode |
| 🤖 **Smart Context** | Numbers only format when surrounded by related words ("ست ساعات" → `6 ساعات`, but "ست" alone stays text) |
| 🔢 **Number Formatting** | Always-on, compositional Arabic parser (units to billions, fractions, percentages) |
| 🧩 **Modular Languages** | Drop-in `lang/*.js` NLP modules for phonetic fuzzy matching and commands |
| 🎯 **Input Picker** | Click to select exactly which field receives text |
| ⌨️ **Keyboard Shortcuts** | Global `Alt+S`, `Alt+L`, `Alt+P` via Chrome Commands |
| 🔒 **Privacy First** | Uses Chrome's built-in Web Speech API — audio never leaves your browser |

## 📦 Installation

### From Source (Developer Mode)

```bash
git clone https://github.com/crrrowz/Vosk-STT-Chrome-Extension.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select the project root folder
4. 🎙️ icon appears in the toolbar

## 🚀 Usage

### Quick Start

1. The mic button auto-appears on every page (configurable)
2. Click any input field, then click the mic
3. Speak — text appears live, then gets inserted
4. Click the mic again to stop

### Local Server Mode (Offline STT)

1. Set up the Python server — see [`server/README.md`](server/README.md)
2. Start the server: `python server/vosk_server.py`
3. Open extension popup → switch to **Local** mode
4. Click **Connect** (default: `ws://localhost:8765`)
5. Click the mic and speak — recognition runs fully offline!

### Settings (Popup)

| Setting | Description |
|---------|-------------|
| **Language Chips** | Switch between عربي / EN |
| **⚡ Quick Switch** | Enable split FAB for instant language toggle |
| **⏱️ Insert Delay** | Buffer speech and insert all at once after a pause (slider) |
| **🎤 Auto-show Mic** | Toggle whether FAB auto-appears on page load |
| **🎯 Pick Input** | Select exactly which field receives text |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Alt + S` | Show FAB / Toggle recording |
| `Alt + L` | Switch language (Arabic ↔ English) |
| `Alt + P` | Pick target input field |

### Arabic Number Recognition

The engine includes a **compositional Arabic number parser** that converts spoken number words to digits:

| You say | You get |
|---------|---------|
| واحد | `1` |
| ثلاثة وعشرين | `23` |
| مئة وخمسة وأربعين | `145` |
| ألف تسعمئة واثنين وثمانين | `1982` |
| خمسة فاصلة ثلاثة | `5.3` |
| خمسين بالمئة | `50%` |

Supports Iraqi dialect variants (ثلطعشر، ستاشر، ثلثين, etc.)

### 🗣️ Voice Commands & Formatting

| English Command | Arabic Command | Output |
|-----------------|----------------|--------|
| `new line` / `enter` | `سطر جديد` / `انتر` | Inserts `\n` |
| `period` / `dot` | `نقطة` | Inserts `.` |
| `comma` | `فاصلة` | Inserts `,` |
| `question mark` | `علامة استفهام` | Inserts `?` |
| `undo` / `delete` | `تراجع` / `امسح` | Deletes the last word |
| `clear all` | `مسح الكل` | Empties the input field |

*See `scripts/speech-engine.js` for the full list of 35+ supported commands.*

## 🏗️ Architecture

```
Vosk-STT-Chrome-Extension/
├── manifest.json              # Extension config (Manifest V3)
├── popup/
│   ├── popup.html             # Popup UI
│   ├── popup.css              # Popup styling
│   └── popup.js               # Popup logic (settings, toggles)
├── scripts/
│   ├── background.js          # Service Worker (chrome.commands routing)
│   ├── content.js             # Content script (injects chain, FAB, DOM)
│   ├── languages.js           # Basic language definitions config
│   ├── speech-engine.js       # Core STT engine (online + local WebSocket)
│   └── lang/                  # Extensible NLP Modules
│       ├── ar.js              # Arabic: numbers, Soundex, commands
│       └── en.js              # English: commands
├── server/
│   ├── vosk_server.py         # Local Vosk WebSocket server
│   ├── requirements.txt       # Python dependencies
│   └── README.md              # Server setup guide
├── styles/
│   └── content.css            # FAB & overlay styling
├── icons/                     # Extension icons (16, 48, 128)
├── assets/                    # Screenshots & demo media
└── audit/                     # Code audit reports & roadmap
```

### Data Flow

```
┌──────────────┐ CustomEvent  ┌────────────────┐ chrome.msg ┌──────────┐
│ Speech Engine│◄────────────►│ Content Script │◄──────────►│ Bkgnd/Pop│
│ (Main World) │ vosk-stt-*   │ (Isolated)     │            │          │
│              │              │ FAB + Overlay  │            │ Shortcuts│
│ Recognition  │              │ Text Insertion │            │ Lang Sel │
│ Voice Cmds   │              │ Input Picker   │            │ State    │
└──────────────┘              └────────────────┘            └──────────┘
```

- **`scripts/background.js`** — Service worker. Listens to global `chrome.commands` and routes actions.
- **`scripts/speech-engine.js`** — Runs in page's main world (required for mic access). Handles Web Speech API (online) and WebSocket client (local server mode), voice commands, and connection health monitoring.
- **`scripts/content.js`** — Runs in Chrome's isolated world. Manages FAB UI, draggable states, text cursor APIs, and overlay updates.
- **`server/vosk_server.py`** — Python WebSocket server for offline STT using native Vosk. Auto-discovers models, streams partial/final results.
- **Communication** — `CustomEvent` between content ↔ engine, `chrome.runtime` between background/popup ↔ content, `WebSocket` between engine ↔ local server.

### Why Main World Injection?

`webkitSpeechRecognition` requires access to the page's audio context, which is not available from Chrome's isolated content script world. The engine is injected via `<script>` tag into the page's main world, and communicates back via `CustomEvent`.

## 🌍 Adding Languages

See [LANGUAGES.md](LANGUAGES.md) for step-by-step instructions.

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines, coding standards, and testing checklist.

**Areas where help is needed:**
- 🌐 More languages and dialect support
- 🧪 Testing on different websites
- 🔢 Number parsing for other languages
- 📱 Touch/mobile improvements

## 🔮 Roadmap

- [x] Split FAB (Quick Switch)  
- [x] 35+ Voice Commands (Arabic & English)
- [x] Text editing commands (undo, delete, clear)
- [x] Global keyboard shortcuts (chrome.commands)
- [x] Auto-show FAB preference toggle
- [x] Accessibility (aria-labels, aria-live, reduced motion)
- [x] Project folder restructuring
- [x] Security audit fixes (XSS, permissions, sanitization)
- [ ] Options page for deeper customization
- [ ] Transcription History panel
- [x] Local Vosk server for offline STT
- [ ] AI Post-Processor via Gemini Nano ([saved code](audit/future-ai-post-processor.md))
- [ ] Extension modularization (esbuild)
- [ ] i18n via Chrome's `_locales` system
- [ ] Firefox / Edge port

## 📄 License

[MIT](LICENSE) — free for personal and commercial use.

## 🙏 Acknowledgments

- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Vosk](https://alphacephei.com/vosk/) — offline speech recognition engine
- Chrome [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
