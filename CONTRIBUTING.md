# Contributing to Vosk STT Extension

Thank you for your interest in contributing! 🎉

## 🚀 Getting Started

1. **Fork** this repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/crrrowz/Vosk-STT-Chrome-Extension.git
   cd Vosk-STT-Chrome-Extension
   ```
3. Load the extension in Chrome (see [README.md](README.md#installation))
4. Make your changes
5. Test thoroughly on different websites
6. Submit a **Pull Request**

## 📁 Project Structure

```
├── manifest.json              # Extension config (Manifest V3)
├── popup/                     # Popup UI (HTML, CSS, JS)
├── scripts/                   # Core logic (background, content, speech-engine)
├── styles/                    # Content script CSS (FAB, overlay)
├── icons/                     # Extension icons
├── assets/                    # Screenshots & demo media
└── audit/                     # Code audit reports & roadmap
```

## 📋 Development Guidelines

### Code Style
- Use `'use strict'` in all JS files
- Prefix all DOM elements with `vosk-` to avoid conflicts
- Use `const` by default, `let` when needed, never `var`
- Keep content script lightweight — heavy work goes to `scripts/speech-engine.js`
- Use named catch parameters (`_err`) to avoid variable shadowing

### Architecture Rules
- **`scripts/speech-engine.js`** — Only speech recognition logic. Runs in page main world.
- **`scripts/content.js`** — DOM manipulation, FAB, overlay, messaging. Runs in isolated world.
- **`popup/popup.js`** — Popup UI logic only. Keep minimal.
- **`scripts/background.js`** — Service worker. Global shortcuts and tab management.
- Communication: `CustomEvent` between content ↔ engine, `chrome.runtime` between background/popup ↔ content.

### CSS Guidelines
- All selectors must be prefixed with `vosk-` or `#vosk-`
- Use CSS custom properties for theming
- Support RTL (use logical properties like `margin-inline-start`)

### Security Rules
- Never use `innerHTML` — always use `document.createElement()` + `appendChild()`
- Sanitize all text from speech events before insertion
- Guard all `chrome.runtime` calls with `isExtensionAlive()` check
- Log errors with context instead of empty `catch` blocks

## 🌍 Adding Languages

See [LANGUAGES.md](LANGUAGES.md) for the complete language guide.

## 🧪 Testing Checklist

Before submitting a PR, test on:
- [ ] Google Search (textarea)
- [ ] ChatGPT (contenteditable)
- [ ] Twitter/X (contenteditable)
- [ ] Standard HTML forms
- [ ] React-based sites (e.g., Facebook)

Test these scenarios:
- [ ] Alt+S shows FAB and toggles recording
- [ ] Alt+L switches language
- [ ] Alt+P opens input picker
- [ ] Dragging the FAB works smoothly
- [ ] Overlay appears above the FAB
- [ ] Text is correctly inserted after recording
- [ ] Extension works after page reload
- [ ] Extension works on newly opened tabs
- [ ] Auto-show toggle ON/OFF works correctly
- [ ] Split FAB language switching works

## 🐛 Reporting Bugs

Open an issue with:
1. Chrome version
2. Website URL where the bug occurs
3. Steps to reproduce
4. Console logs (`F12` → Console → filter `[Vosk STT]`)
5. Expected vs actual behavior

## 💡 Feature Requests

Open an issue with the `enhancement` label. Describe:
1. What you want to achieve
2. Why the current functionality is insufficient
3. Proposed solution (if any)

## 📝 Commit Messages

Use conventional commits:
```
feat: add French language support
fix: overlay positioning on RTL pages
docs: update language guide
refactor: reorganize project structure
style: improve FAB hover animation
```

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.
