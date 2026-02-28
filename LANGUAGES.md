# 🌍 Adding Language Support

This guide explains how to add new languages to the Vosk STT extension.

## Supported Languages

The Web Speech API supports any language with a [BCP-47 language tag](https://www.ietf.org/rfc/bcp/bcp47.txt). 

### Currently Included
| Code | Language | Default |
|------|----------|---------|
| `ar-IQ` | Arabic (Iraq) | ✅ |
| `ar-SA` | Arabic (Saudi Arabia) | |
| `en-US` | English (United States) | |

## How to Add a New Language

### Step 1: Add Language Chip (`popup/popup.html`)

Add a new button inside the `.lang-row` div:

```html
<div class="lang-row">
  <button class="lang-chip active" data-lang="ar-IQ">عربي</button>
  <button class="lang-chip" data-lang="en-US">EN</button>
  <!-- ADD YOUR LANGUAGE HERE -->
  <button class="lang-chip" data-lang="fr-FR">FR</button>
</div>
```

> **Note:** If adding more than 3 languages, consider using a grid layout:
> ```css
> .lang-row { flex-wrap: wrap; }
> .lang-chip { flex: 0 0 calc(50% - 4px); }
> ```

### Step 2: Update Language Labels (`scripts/content.js`)

Add the label and short code to the `LANG_LABELS` and `LANG_SHORT` objects:

```javascript
const LANG_LABELS = {
    'ar-IQ': 'عربي', 'ar-SA': 'عربي', 'ar': 'عربي', 'en-US': 'EN',
    'fr-FR': 'FR',  // ← add here
};
const LANG_SHORT = {
    'ar-IQ': 'AR', 'ar-SA': 'AR', 'ar': 'AR', 'en-US': 'EN',
    'fr-FR': 'FR',  // ← add here
};
```

### Step 3: Update Language Toggle (`scripts/speech-engine.js`)

The `switchLang` command currently toggles between AR ↔ EN. To support cycling through multiple languages:

```javascript
// In the 'switchLang' handler, replace:
currentLang = currentLang.startsWith('ar') ? 'en-US' : 'ar-IQ';

// With:
const langs = ['ar-IQ', 'en-US', 'fr-FR']; // add your lang
const idx = langs.indexOf(currentLang);
currentLang = langs[(idx + 1) % langs.length];
```

### Step 4: Test

1. Reload the extension (`chrome://extensions` → ↻)
2. Reload the page
3. Select your new language from the popup
4. Test recognition with native speech

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
- The overlay and FAB already support RTL via `direction: rtl`
- Text insertion respects cursor position
- No additional changes needed

## Offline Languages (Vosk)

To use Vosk for offline recognition (no internet needed):
1. Download a model from [alphacephei.com/vosk/models](https://alphacephei.com/vosk/models)
2. The extension would need `vosk-browser` WASM integration
3. See the issue tracker for offline mode progress

> **Note:** Offline mode is a planned feature and not yet implemented in this extension.
