# 🌍 Adding Language Support

This guide explains how to add new languages to the Vosk STT extension.

## Architecture

Language support has **two layers**:

1. **Basic** (required): Add to `scripts/languages.js` — enables recognition for any language
2. **NLP Module** (optional): Create `scripts/lang/{code}.js` — adds number conversion, voice commands, text normalization, and phonetic fuzzy matching

Without an NLP module, a language still works for basic speech-to-text. The NLP module adds intelligence.

## Currently Active

| Code | Language | Default | NLP Module |
|------|----------|---------|------------|
| `ar-IQ` | Arabic (Iraq) | ✅ | `lang/ar.js` — normalizer, numbers, soundex, 30+ commands |
| `en-US` | English (US) | | `lang/en.js` — 25+ commands |

## Step 1: Add Language (Required)

Open `scripts/languages.js` and add one line:

```javascript
const VOSK_LANGUAGES = [
    { code: 'ar-IQ', label: 'عربي', short: 'AR', rtl: true },
    { code: 'en-US', label: 'EN', short: 'EN', rtl: false },
    { code: 'fr-FR', label: 'FR', short: 'FR', rtl: false },  // ← add this
];
```

**That's it for basic support.** The extension updates automatically:
- ✅ Popup shows a new language chip
- ✅ FAB badge displays the correct short code
- ✅ `Alt+L` cycles through all registered languages

## Step 2: Create NLP Module (Optional)

Create `scripts/lang/fr.js` with this structure:

```javascript
(() => {
    'use strict';
    window.__voskLangModules = window.__voskLangModules || {};

    window.__voskLangModules['fr'] = {
        match: (langCode) => langCode.startsWith('fr'),
        normalize: (text) => text,  // optional text normalization
        postProcess: (text) => text, // optional number/format conversion

        voiceCommands: {
            'nouvelle ligne': '\n',
            'virgule': ',',
            'point': '.',
            'point interrogation': '?',
            'tout effacer': '__CMD:clear',
            'annuler': '__CMD:undo',
            'supprimer': '__CMD:delete',
            'tout sélectionner': '__CMD:selectAll',
        },
    };
})();
```

**That's it.** Drop the file in `scripts/lang/` and it will be auto-discovered from Language Names. No changes to `content.js` or `manifest.json` needed.

### Module API

| Property | Type | Required | Purpose |
|----------|------|----------|---------|
| `match(langCode)` | Function → bool | ✅ | Returns `true` if this module handles the given language code |
| `normalize(text)` | Function → string | | Text normalization (e.g. Arabic diacritics removal) |
| `postProcess(text)` | Function → string | | Number conversion, formatting |
| `soundex(text)` | Function → string | | Phonetic collapsing for fuzzy command matching |
| `voiceCommands` | Object | | Key-value map: spoken phrase → character or `__CMD:action` |

### Voice Command Types

| Prefix | Behavior | Example |
|--------|----------|---------|
| *(none)* | Inline text replacement | `'virgule': ','` — inserts `,` |
| `__CMD:` | Triggers action in content.js | `'__CMD:clear'` — clears input |

Available commands: `clear`, `undo`, `delete`, `selectAll`

## Field Reference

| Field | Purpose | Example |
|-------|---------|---------| 
| `code` | BCP-47 language code | `'fr-FR'` |
| `label` | Text on popup chip | `'FR'` or `'Français'` |
| `short` | 2-letter FAB badge | `'FR'` |
| `rtl` | Right-to-left flag | `false` |

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

## Local Server Model

To enable offline STT for a new language, download a Vosk model and place it in:

```
server/models/<lang-prefix>/
    └── vosk-model-<name>/
        ├── am/
        └── ...
```

For example, to add French offline support:
```
server/models/fr/vosk-model-fr-0.22/
```

The server auto-discovers models on startup and loads them on-demand when requested.
Download models from [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models).
