# 🌍 Adding Language Support

This guide explains how to add new languages to the Vosk STT extension.

## Supported Languages

The Web Speech API supports any language with a [BCP-47 language tag](https://www.ietf.org/rfc/bcp/bcp47.txt). 

### Currently Active
| Code | Language | Default |
|------|----------|---------|
| `ar-IQ` | Arabic (Iraq) | ✅ |
| `en-US` | English (United States) | |

## How to Add a New Language

### ✅ One-Step Process

Open `scripts/languages.js` and add **one line** to the `VOSK_LANGUAGES` array:

```javascript
const VOSK_LANGUAGES = [
    { code: 'ar-IQ', label: 'عربي', short: 'AR', rtl: true },
    { code: 'en-US', label: 'EN', short: 'EN', rtl: false },
    { code: 'fr-FR', label: 'FR', short: 'FR', rtl: false },  // ← just add this
];
```

**That's it.** The entire extension updates automatically:
- ✅ Popup shows a new language chip
- ✅ FAB badge displays the correct short code
- ✅ Overlay header shows the correct label
- ✅ `Alt+L` cycles through all registered languages

### Field Reference

| Field | Purpose | Example |
|-------|---------|---------|
| `code` | BCP-47 language code for the Web Speech API | `'fr-FR'` |
| `label` | Text shown on the popup chip button | `'FR'` or `'Français'` |
| `short` | 2-letter code shown on the FAB badge | `'FR'` |
| `rtl` | `true` for right-to-left languages | `false` |

### Test

1. Reload the extension (`chrome://extensions` → ↻)
2. Reload the page
3. Open popup → new language chip should appear
4. Click it and speak → verify recognition works
5. Press `Alt+L` → verify it cycles through all languages

## Common Language Codes

| Code | Language | Flag |
|------|----------|------|
| `ar-IQ` | Arabic (Iraq) | 🇮🇶 |
| `ar-SA` | Arabic (Saudi Arabia) | 🇸🇦 |
| `ar-EG` | Arabic (Egypt) | 🇪🇬 |
| `en-US` | English (US) | 🇺🇸 |
| `en-GB` | English (UK) | 🇬🇧 |
| `fr-FR` | French | 🇫🇷 |
| `de-DE` | German | 🇩🇪 |
| `es-ES` | Spanish (Spain) | 🇪🇸 |
| `pt-BR` | Portuguese (Brazil) | 🇧🇷 |
| `ja-JP` | Japanese | 🇯🇵 |
| `ko-KR` | Korean | 🇰🇷 |
| `zh-CN` | Chinese (Simplified) | 🇨🇳 |
| `ru-RU` | Russian | 🇷🇺 |
| `tr-TR` | Turkish | 🇹🇷 |
| `hi-IN` | Hindi | 🇮🇳 |

## RTL Considerations

For RTL languages (Arabic, Hebrew, Persian):
- Set `rtl: true` in the language entry
- The overlay and FAB already support RTL via `direction: rtl`
- Text insertion respects cursor position

## Offline Languages (Vosk)

> **Note:** Offline mode is a planned feature and not yet implemented.

To use Vosk for offline recognition in the future:
1. Download a model from [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models)
2. The extension would need `vosk-browser` WASM integration
3. See the roadmap in `audit/03-future-roadmap.md` for progress
