<div align="center">

# 🎙️ Vosk STT — Chrome Extension

**Real-time Speech-to-Text directly into any input field**

[![License: MIT](https://img.shields.io/badge/License-MIT-6C3CE1.svg)](LICENSE)
[![Chrome](https://img.shields.io/badge/Chrome-Extension-4F8FFF.svg)]()
[![Manifest](https://img.shields.io/badge/Manifest-V3-green.svg)]()

<img src="assets/Gemini_Generated_Image_q3wwekq3wwekq3ww.png" width="800" alt="Vosk STT Extension" style="border-radius: 8px; margin-top: 20px;" />

<br/><br/>

**Demonstration Video**

<video src="assets/Chrome_Extension_Concept_Video.mp4" width="800" controls style="border-radius: 8px; margin-top: 10px;"></video>

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🎤 **Floating Mic Button** | Draggable FAB on any page — click to start/stop. Persists dragged position. |
| ⚡ **Split Quick Switch** | Optional Split FAB to instantly swap between Arabic & English live |
| 📝 **Live Transcription** | See text appear in real-time as you speak |
| 🗣️ **Voice Commands** | Say "new line", "period", "comma", "نقطة", "سطر جديد" to format text |
| ↩️ **Editing Commands** | Say "delete", "undo" or "امسح" to remove last word; "clear" to empty field |
| 🌐 **Arabic + English** | Iraqi Arabic, Standard Arabic, English, and Mixed mode |
| 🔢 **Smart Numbers** | Speaks "ألف تسعمئة واثنين وثمانين" → writes `1982` |
| 🎯 **Input Picker** | Click to select exactly which field receives text |
| ⌨️ **Keyboard Shortcuts** | Global `Alt+S`, `Alt+L`, `Alt+P` for instant access anywhere via Chrome Commands |
| 🚀 **Zero Config** | No API keys, no models, no signup |
| 🔒 **Privacy First** | Uses Chrome's built-in Web Speech API — audio never leaves your browser |

## 📦 Installation

### From Source (Developer Mode)

```bash
git clone https://github.com/crrrowz/vosk-stt-extension.git
```

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right)
3. Click **Load unpacked** → select the `chrome-extension/` folder
4. 🎙️ icon appears in the toolbar

## 🚀 Usage

### Quick Start

1. Click the extension icon → **"🎤 Show Mic Button"**
2. A floating mic button appears on the page
3. Click any input field, then click the mic
4. Speak — text appears live, then gets inserted
5. Click the mic again to stop

### Language Modes

| Mode | Description |
|------|-------------|
| **عربي** | Iraqi Arabic (`ar-IQ`) — great for Iraqi dialect |
| **EN** | English (`en-US`) |
| **عربي+EN** | Mixed mode — uses generic Arabic which can pick up English words embedded in Arabic speech |

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
| اثنين بالعشرة | `0.2` |
| خمسين بالمئة | `50%` |

Supports Iraqi dialect variants (ثلطعشر، ستاشر، ثلثين, etc.)

### 🗣️ Voice Commands & Formatting

You can format text and edit content using your voice in both Arabic and English:

| English Command | Arabic Command | Output |
|-----------------|----------------|--------|
| `new line` / `enter` | `سطر جديد` / `انتر` | Inserts `\n` |
| `period` / `dot` | `نقطة` | Inserts `.` |
| `comma` | `فاصلة` | Inserts `,` |
| `question mark` | `علامة استفهام` | Inserts `?` |
| `undo` / `delete` | `تراجع` / `امسح` | Deletes the last word |
| `clear all` | `مسح الكل` | Empties the input field |

*See `speech-engine.js` for the full list of 35 supported commands.*

## 🏗️ Architecture

```
chrome-extension/
├── manifest.json          # Extension config (Manifest V3)
├── background.js          # Service Worker (Global Shortcuts via chrome.commands)
├── popup.html/css/js      # Popup UI (language selection, split toggle, shortcuts)
├── content.js             # Content script (FAB, overlay, picker, DOM manipulation)
├── content.css            # Overlay & FAB styling
├── speech-engine.js       # Speech recognition & Voice Commands (page main world)
├── icons/                 # Extension icons (16, 32, 48, 128)
├── README.md              # This file
├── LICENSE                # MIT License
├── CONTRIBUTING.md        # Contribution guide
├── LANGUAGES.md           # Adding language support
└── CHANGELOG.md           # Version history
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

- **`background.js`** — Extension service worker. Listens to OS-level global `chrome.commands` and routes actions.
- **`speech-engine.js`** — Runs in page's main world (required for mic access). Handles recognition, number parsing, and voice commands.
- **`content.js`** — Runs in Chrome's isolated world. Manages FAB UI, draggable states, text cursor APIs, and overlay updates.
- **Communication** — `CustomEvent` between content ↔ engine, `chrome.runtime` between background/popup ↔ content.

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
- 🔌 Vosk WASM integration for offline mode

## 🔮 Roadmap

- [ ] Extension Modularization (esbuild)
- [ ] Offline mode via Vosk WASM
- [x] Punctuation and formatting voice commands
- [x] Copy-to-clipboard / Keyboard Shortcut overhaul
- [ ] Settings page for deeper customization
- [ ] Transcription History panel
- [ ] Firefox / Edge extension port

## 📄 License

[MIT](LICENSE) — free for personal and commercial use.

## 🙏 Acknowledgments

- [Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API)
- [Vosk](https://alphacephei.com/vosk/) — future offline integration
- Chrome [Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
