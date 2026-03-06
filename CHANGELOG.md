# Changelog

All notable changes to this project will be documented in this file.

## [2.2.0] - 2026-03-07

### Added
- 🖥️ **Local Server Mode** — Python WebSocket server (`server/vosk_server.py`) for offline STT via native Vosk.
- 🔌 **On-Demand Model Loading** — Server scans `models/<lang>/` and loads models only when requested.
- 🌐 **Bridge Architecture** — WebSocket in content.js (extension CSP), mic in speech-engine.js (main world).
- 🔄 **Seamless Language Switch** — Local mode sends `configure` without reconnecting; server hot-swaps model.
- 🏎️ **Auto Engine Mode** — Races Online (Google) + Local (Vosk) simultaneously, first result wins.
- 🔴 **Live Settings Sync** — Changing engine mode or language in popup auto-restarts recognition without toggling FAB.
- 🐕 **Local Watchdog** — Detects stale local server connections and auto-reconnects.

### Fixed
- 🐛 **Auto Mode Restart Loop** — Online `onend` no longer re-races both engines; each restarts independently.
- 🐛 **`_autoWinner` Leak** — Auto mode winner state now resets on stop, preventing stale decisions.
- 🐛 **Stacked Event Listener** — `vosk-server-msg` handler now removed on re-inject, preventing duplicate results.
- 🐛 **False Reconnect on Stop** — Intentional WebSocket close no longer triggers reconnect attempts.
- 🐛 **`onend` Flush Bypass** — Pending interim results in online mode now respect `autoGate` in Auto mode.

### Changed
- 🏗️ **Removed WASM/Offscreen** — Deleted `offscreen/`, `popup/zip-to-targz.js`, `tools/convert_model.py`.
- 📋 **Manifest Cleanup** — Removed `offscreen` permission, sandbox, `wasm-unsafe-eval`.
- 🎨 **Popup UI** — Server status auto-detected on open. Removed manual URL input and Connect button.
- ⚡ **Separate Restart Counters** — Online and Local engines use independent restart budgets in Auto mode.

---

## [2.1.0] - 2026-03-06

### Fixed
- 🐛 **Online Mode Stuck / Loop** — Rapid "Speaking ↔ Listening" loop caused by flat 200ms restart delay + watchdog and onend both scheduling restarts. Fixed with exponential backoff (500ms→5s) and a `pendingRestart` guard.

### Changed
- ⚡ **MAX_RESTARTS** reduced from `200` → `20` with exponential backoff to prevent 100-second loop storms
- ⚡ **Watchdog Interval** increased from `8s` → `10s` to reduce false positive force-restarts
- 🧹 **Removed AI Post-Processor (Gemini Nano)** — Code preserved in [`audit/future-ai-post-processor.md`](audit/future-ai-post-processor.md).
- 🔍 **40+ Console Logs** — Added prefixed logs across all pipeline stages for debugging.

---

## [2.0.0] - 2026-03-02

### Major Architectural Rewrite
- 🧩 **Modular NLP Engine** — The monolithic speech engine was split into a language-agnostic core (`speech-engine.js`) and extensible language modules (`scripts/lang/*.js`).
- ⚡ **Dynamic Module Loading** — Language modules are auto-discovered and injected dynamically based on the active language list. No manifest tweaks needed to add new languages.
- 🧠 **Smart Context Scorer** — Arabic number formatting now uses a sliding window context scorer. Words like "ست" (six) only convert to `6` if surrounded by time/measurement units, preventing narrative text mangling.
- ⏱️ **Flawless Insert Buffering** — The "Insert Delay" feature was rewritten to properly accumulate interim results and only flush after *complete* silence, fixing the disjointed insertion bugs.
- 🔄 **Always-On Intelligence** — Number Formatting is now deeply integrated and always-on. Removed brittle popup toggles.

### Fixed
- 🐛 **Overlay Glitch** — Fixed bug where the overlay would disappear mid-speech due to the engine exhausting its internal restart budget (capped at 50). The budget now correctly resets upon successful transcription.
- 🐛 **Double Insertion** — Fixed race condition where interim results could double-trigger insertion right as the engine naturally paused.
- 🐛 **Taa Marbuta & Ha Bugs** — Normalized Arabic trailing characters so voice commands work regardless of how Google STT spells them (ة vs ه).

---

## [1.2.0] - 2026-02-28

### Added
- 🎤 **Auto-show Mic Toggle** — new popup setting to control whether the FAB auto-appears on page load
- 🔄 **Live Setting Sync** — toggling "Auto-show Mic" OFF instantly removes the FAB from all tabs via `chrome.storage.onChanged`

### Changed
- 📁 **Project Restructuring** — organized flat files into `popup/`, `scripts/`, `styles/`, and `audit/` folders
- 📝 **Documentation Update** — README, CHANGELOG, CONTRIBUTING, LANGUAGES, and .gitignore updated to reflect new structure

## [1.1.0] - 2026-02-28

### Added
- ⚡ **Split FAB (Quick Switch)** — instant language switching (AR/EN) by clicking the FAB halves
- 🗣️ **35+ Voice Commands** (Arabic & English) for punctuation and text formatting
- ↩️ **Text Editing Commands** — say "امسح" or "delete" to remove last word, "مسح الكل" to clear field
- 🔄 **Background Service Worker** — keyboard shortcuts now use `chrome.commands` and work globally across the entire OS level

### Security & Architecture (Audit Fixes)
- 🔒 **XSS Prevention** — completely removed 3 `innerHTML` injection vectors, replaced with safe DOM APIs
- 🛡️ **Tightened Permissions** — `content_scripts` and `web_accessible_resources` restricted to `http/https` only (removed broad `<all_urls>`)
- 🔐 **Input Sanitization** — text from speech events is sanitized to strip HTML tags and control characters
- ♿ **Accessibility** — `aria-label`, `role="status"`, `aria-live="polite"` added to FAB and overlay
- 💾 **State Persistence** — dragged FAB position now saves and restores across page loads
- ⚡ **Performance** — DOM queries cached with 2s TTL; `positionOverlay` debounced via `requestAnimationFrame`; regex patterns pre-compiled at module level
- 🌐 **Unified Defaults** — centralized default language to `ar-IQ` across all files
- 🧹 **Code Cleanup** — removed dead code, consolidated duplicate drag detection, fixed variable shadowing, added extension context guards

## [1.0.0] - 2026-02-28

### Added
- 🎤 Floating Action Button (FAB) — draggable mic button on any webpage
- 📝 Live transcription overlay with real-time preview
- 🌐 Language support: Iraqi Arabic, Standard Arabic, English
- 🔄 Mixed language mode (عربي+EN) — handles Arabic and English in one stream
- 🔢 Compositional Arabic number parser (units, teens, tens, hundreds, thousands, millions, billions, fractions, percentages)
- 🎯 Input picker — click to select target field
- ⌨️ Keyboard shortcuts: Alt+S, Alt+L, Alt+P
- 🔁 Auto-restart on silence with configurable max restarts
- 📄 Delta-only text insertion — prevents duplicate text
- 📖 Full documentation: README, CONTRIBUTING, LANGUAGES, LICENSE
