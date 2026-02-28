# Changelog

All notable changes to this project will be documented in this file.

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
