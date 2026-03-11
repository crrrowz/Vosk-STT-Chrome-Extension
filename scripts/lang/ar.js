// Arabic language module for Vosk STT
// Registers: normalizer, number parser, voice commands, soundex
(() => {
    'use strict';

    window.__voskLangModules = window.__voskLangModules || {};

    /* ── Normalizer ── */

    function normalizeArabic(text) {
        return text
            .replace(/\u0640/g, '')               // strip tatweel
            .replace(/[\u064B-\u065F\u0670]/g, '') // strip tashkeel
            .replace(/[إأآٱ]/g, 'ا')              // alef variants → bare alef
            .replace(/ؤ/g, 'و')                   // hamza on waw
            .replace(/ئ/g, 'ي')                   // hamza on ya
            .replace(/ى(?=\s|$)/g, 'ي')           // alef maqsura → ya
            .replace(/ه(?=\s|$)/g, 'ة');           // ha → taa marbuta
    }

    /* ── Arabic Soundex (phonetic grouping) ── */

    function arabicSoundex(word) {
        if (!word) return '';
        const w = normalizeArabic(word);
        const map = {
            'ب': '1', 'ف': '1', 'ڤ': '1', 'پ': '1',               // labials
            'ت': '2', 'ث': '2', 'د': '2', 'ذ': '2', 'ط': '2', 'ظ': '2', // dentals
            'ج': '3', 'ش': '3', 'ز': '3', 'ص': '3', 'ض': '3', 'چ': '3', // sibilants
            'س': '3',
            'ق': '4', 'ك': '4', 'غ': '4', 'خ': '4', 'ڭ': '4',    // velars
            'ل': '5', 'ر': '5', 'ن': '5',                          // liquids/nasals
            'م': '6',                                                // nasal labial
            'ه': '7', 'ح': '7', 'ع': '7', 'ء': '7', 'ا': '7',    // glottals
            'و': '0', 'ي': '0',                                     // semivowels
        };
        let result = '';
        let prev = '';
        for (const ch of w) {
            const code = map[ch] || '';
            if (code && code !== prev) {
                result += code;
                prev = code;
            } else if (!code) {
                prev = '';
            }
        }
        return result.slice(0, 6);
    }

    /* ── Register Module ── */

    window.__voskLangModules['ar'] = {
        // Matches lang codes starting with 'ar'
        match: (langCode) => langCode.startsWith('ar'),

        normalize: normalizeArabic,

        soundex: arabicSoundex,

        postProcess(text) {
            if (!text) return text;
            if (/[\u0600-\u06FF]/.test(text)) {
                text = normalizeArabic(text);
            }
            return text;
        },

        voiceCommands: {
            'سطر جديد': '\n', 'سطر': '\n', 'انتر': '\n',
            'فاصلة': '،', 'فارزة': '،',
            'نقطة': '.', 'نقطه': '.',
            'علامة استفهام': '؟', 'سؤال': '؟',
            'علامة تعجب': '!',
            'نقطتين': ':', 'نقطتان': ':',
            'فاصلة منقوطة': '؛',
            'فتح قوس': '(', 'غلق قوس': ')', 'اغلق قوس': ')',
            'فتح قوس مربع': '[', 'غلق قوس مربع': ']',
            'فتح قوس معقوف': '{', 'غلق قوس معقوف': '}',
            'اقتباس': '"', 'علامة اقتباس': '"',
            'شرطة': '-', 'شرطه': '-',
            'نجمة': '*', 'نجمه': '*',
            'شباك': '#',
            'مسافة': ' ', 'فراغ': ' ',
            'مسح الكل': '__CMD:clear', 'امسح الكل': '__CMD:clear',
            'تراجع': '__CMD:undo',
            'امسح': '__CMD:delete', 'حذف': '__CMD:delete',
            'اختر الكل': '__CMD:selectAll',
        },
    };
})();
