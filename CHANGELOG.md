# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-02-28

### Added
- ⚡ **Split FAB (Quick Switch)** — instant language switching (AR/EN) by clicking the FAB halves
- 🗣️ **35+ Voice Commands** (Arabic & English) for punctuation and text formatting
- ↩️ **Text Editing Commands** — say "امسح" or "delete" to remove last word, "مسح الكل" to clear field
- 🔄 **Background Service Worker** — keyboard shortcuts now use `chrome.commands` and work globally across the entire OS level

### Security & Architecture (Audit Fixes)
- 🔒 **XSS Prevention** — completely removed 3 `innerHTML` injection vectors, replaced with safe DOM APIs
- 🛡️ **Tightened Permissions** — `content_scripts` and `web_accessible_resources` restricted to `http/https` only (removed broad `<all_urls>`)
- 💾 **State Persistence** — dragged FAB position now saves and restores across page loads
- ⚡ **Performance Optimization** — TreeWalker replaced with recursive DOM traversal (`O(depth)`); 12 regex patterns pre-compiled and cached to prevent rebuilding on every speech result
- 🌐 **Unified Defaults** — centralized default language to `ar-IQ` across all files to fix startup mismatches
- 🗑️ **Refactoring** — removed redundant drag detectors, consolidated event delegation, eliminated dead code and unused components

## [1.0.0] - 2026-02-28

### Added
- 🎤 Floating Action Button (FAB) — draggable mic button on any webpage
- 📝 Live transcription overlay with real-time preview
- 🌐 Language support: Iraqi Arabic, Standard Arabic, English
- 🔄 Mixed language mode (عربي+EN) — handles Arabic and English in one stream
- 🔢 Compositional Arabic number parser:
  - Units, teens, tens, hundreds, thousands, millions, billions
  - Iraqi dialect variants (حداشر، ستاشر، ثلثين, etc.)
  - Compound numbers (ألف تسعمئة واثنين وثمانين → 1982)
  - Fractions (فاصلة، نقطة)
  - Percentages (بالمئة)
- 🎯 Input picker — click to select target field
- ⌨️ Keyboard shortcuts: Alt+S, Alt+L, Alt+P
- 🔁 Auto-restart on silence with configurable max restarts
- 📄 Delta-only text insertion — prevents duplicate text
- 🔄 Re-injectable engine — survives extension reloads
- 📖 Full documentation: README, CONTRIBUTING, LANGUAGES, LICENSE
