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
