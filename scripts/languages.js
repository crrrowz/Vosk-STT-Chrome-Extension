// ─── Shared Language Registry ───
// SINGLE SOURCE OF TRUTH — add a language here and it works everywhere.
// Used by: content.js, speech-engine.js, popup.js
(function () {
    'use strict';

    const VOSK_LANGUAGES = [
        { code: 'ar-IQ', label: 'عربي', short: 'AR', rtl: true },
        { code: 'en-US', label: 'EN', short: 'EN', rtl: false },
        // ┌────────────────────────────────────────────────────┐
        // │  To add a language, just add a line here:          │
        // │  { code: 'fr-FR', label: 'FR', short: 'FR', rtl: false },  │
        // └────────────────────────────────────────────────────┘
    ];

    const DEFAULT_LANG = 'ar-IQ';

    function getLangLabel(code) {
        const lang = VOSK_LANGUAGES.find(l => l.code === code || (l.code.startsWith('ar') && code.startsWith('ar')));
        return lang ? lang.label : code;
    }

    function getLangShort(code) {
        const lang = VOSK_LANGUAGES.find(l => l.code === code || (l.code.startsWith('ar') && code.startsWith('ar')));
        return lang ? lang.short : code.split('-')[0].toUpperCase();
    }

    function getNextLang(currentCode) {
        const idx = VOSK_LANGUAGES.findIndex(l => l.code === currentCode);
        if (idx === -1) return VOSK_LANGUAGES[0].code;
        return VOSK_LANGUAGES[(idx + 1) % VOSK_LANGUAGES.length].code;
    }

    window.VOSK_LANG_CONFIG = {
        languages: VOSK_LANGUAGES,
        defaultLang: DEFAULT_LANG,
        getLangLabel,
        getLangShort,
        getNextLang,
    };
})();
