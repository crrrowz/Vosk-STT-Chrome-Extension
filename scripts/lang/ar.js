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

    /* ── Number Parser ── */

    function normKeys(dict) {
        const out = {};
        for (const [k, v] of Object.entries(dict)) out[normalizeArabic(k)] = v;
        return out;
    }

    const UNITS = normKeys({
        'صفر': 0, 'واحد': 1, 'وحدة': 1, 'اثنين': 2, 'اثنان': 2, 'ثنين': 2,
        'ثلاثة': 3, 'ثلاث': 3, 'اربعة': 4, 'أربعة': 4, 'اربع': 4, 'أربع': 4,
        'خمسة': 5, 'خمس': 5, 'ستة': 6, 'ست': 6,
        'سبعة': 7, 'سبع': 7, 'ثمانية': 8, 'ثمان': 8, 'ثماني': 8,
        'تسعة': 9, 'تسع': 9,
    });

    const TEENS = normKeys({
        'احد عشر': 11, 'أحد عشر': 11, 'حدعشر': 11, 'حداشر': 11,
        'اثني عشر': 12, 'اثنا عشر': 12, 'اثناعشر': 12, 'اثنعشر': 12,
        'ثلاث عشر': 13, 'ثلاثة عشر': 13, 'ثلاثعشر': 13, 'ثلطعشر': 13,
        'اربع عشر': 14, 'أربعة عشر': 14, 'اربعطعشر': 14, 'اربعتعشر': 14,
        'خمس عشر': 15, 'خمسة عشر': 15, 'خمسطعشر': 15, 'خمستعشر': 15,
        'ست عشر': 16, 'ستة عشر': 16, 'ستطعشر': 16, 'سطعشر': 16, 'ستاشر': 16,
        'سبع عشر': 17, 'سبعة عشر': 17, 'سبعطعشر': 17, 'سبعتعشر': 17,
        'ثمان عشر': 18, 'ثمانية عشر': 18, 'ثمنطعشر': 18, 'ثمانتعشر': 18,
        'تسع عشر': 19, 'تسعة عشر': 19, 'تسعطعشر': 19, 'تسعتعشر': 19,
    });

    const TENS = normKeys({
        'عشرة': 10, 'عشر': 10,
        'عشرين': 20, 'ثلاثين': 30, 'ثلثين': 30,
        'اربعين': 40, 'أربعين': 40,
        'خمسين': 50, 'ستين': 60,
        'سبعين': 70, 'ثمانين': 80, 'تسعين': 90,
    });

    const HUNDREDS = normKeys({
        'مئة': 100, 'مية': 100, 'مائة': 100, 'ميه': 100,
        'مئتين': 200, 'ميتين': 200, 'مئتان': 200,
        'ثلاثمئة': 300, 'ثلاثمية': 300, 'ثلثمية': 300,
        'اربعمئة': 400, 'أربعمئة': 400, 'اربعمية': 400,
        'خمسمئة': 500, 'خمسمية': 500,
        'ستمئة': 600, 'ستمية': 600,
        'سبعمئة': 700, 'سبعمية': 700,
        'ثمانمئة': 800, 'ثمانمية': 800, 'ثمنمية': 800,
        'تسعمئة': 900, 'تسعمية': 900,
    });

    const LARGE = normKeys({
        'الف': 1000, 'ألف': 1000, 'آلاف': 1000,
        'الفين': 2000, 'ألفين': 2000,
        'مليون': 1000000, 'ملايين': 1000000,
        'مليار': 1000000000, 'مليارات': 1000000000,
    });

    const ALL_NUM_WORDS = {};
    Object.assign(ALL_NUM_WORDS, UNITS, TEENS, TENS, HUNDREDS, LARGE);
    const SORTED_WORDS = Object.keys(ALL_NUM_WORDS).sort((a, b) => b.length - a.length);

    const NUM_WORD_PATTERN = SORTED_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const AR_BL = '(?<![\\u0600-\\u06FF\\u0750-\\u077F])';
    const AR_BR = '(?![\\u0600-\\u06FF\\u0750-\\u077F])';

    const NUM_SEQUENCE_REGEX = new RegExp(
        AR_BL
        + `(?:(?:${NUM_WORD_PATTERN})(?:\\s+و?\\s*|\\s*و\\s*))+(?:${NUM_WORD_PATTERN})`
        + `|(?:${NUM_WORD_PATTERN})`
        + AR_BR,
        'gu'
    );

    const UNIT_CONTEXT = new Set([
        'سنة', 'سنوات', 'شهر', 'اشهر', 'يوم', 'ايام', 'ساعة', 'ساعات',
        'دقيقة', 'دقايق', 'ثانية', 'ثواني',
        'كيلو', 'كيلومتر', 'متر', 'سنتيمتر', 'ملليمتر',
        'كيلوغرام', 'غرام', 'طن', 'لتر', 'مليلتر', 'غالون',
        'درجة', 'درجات',
        'دينار', 'دنانير', 'دولار', 'دولارات', 'ريال', 'ريالات',
        'جنيه', 'جنيهات', 'درهم', 'دراهم', 'يورو', 'فلس', 'فلوس',
        'زايد', 'ناقص', 'ضرب', 'تقسيم', 'يساوي', 'اكبر', 'اصغر',
        'نسبة', 'نقطة', 'فاصلة',
        'مرة', 'مرات', 'قطعة', 'قطع', 'حبة', 'حبات',
        'صفحة', 'صفحات', 'سطر', 'اسطر',
        'شخص', 'اشخاص', 'طالب', 'طلاب',
    ].map(normalizeArabic));

    function parseArabicNumber(sequence) {
        const tokens = [];
        let remaining = sequence.trim();
        while (remaining.length > 0) {
            remaining = remaining.replace(/^[\s,و]+/, '');
            if (!remaining) break;
            let matched = false;
            for (const word of SORTED_WORDS) {
                if (remaining.startsWith(word)) {
                    const after = remaining.substring(word.length);
                    if (after.length === 0 || /^[\s,و]/.test(after)) {
                        tokens.push(ALL_NUM_WORDS[word]);
                        remaining = after;
                        matched = true;
                        break;
                    }
                }
            }
            if (!matched) break;
        }
        if (tokens.length === 0) return null;
        let result = 0, current = 0;
        for (const val of tokens) {
            if (val >= 1000) {
                if (current === 0) current = 1;
                result += current * val;
                current = 0;
            } else if (val >= 100) {
                if (current > 0 && current < 10) current *= val;
                else current += val;
            } else {
                current += val;
            }
        }
        result += current;
        return result;
    }

    function isNumWord(w) { return w in ALL_NUM_WORDS; }

    function hasNumericContext(words, matchStart, matchEnd) {
        if (matchEnd - matchStart > 1) return true;
        if (ALL_NUM_WORDS[words[matchStart]] >= 100) return true;
        for (let i = Math.max(0, matchStart - 2); i < Math.min(words.length, matchEnd + 2); i++) {
            if (i >= matchStart && i < matchEnd) continue;
            const neighbor = words[i];
            if (neighbor === 'و') continue;
            if (isNumWord(neighbor)) return true;
            if (UNIT_CONTEXT.has(neighbor)) return true;
        }
        return false;
    }

    // Pre-compiled regex patterns
    const BAL = '\u0628[\u0627\u0640]?\u0644\\s*';
    const RE_TENTH = new RegExp(`${AR_BL}(${NUM_WORD_PATTERN})\\s+${BAL}\u0639\u0634\u0631[\u0629\u0647]?`, 'gu');
    const RE_PERCENT_W = new RegExp(`${AR_BL}(${NUM_WORD_PATTERN})\\s+${BAL}\u0645[\u0626\u064A][\u0629\u0647]`, 'gu');
    const RE_THOUSAND_W = new RegExp(`${AR_BL}(${NUM_WORD_PATTERN})\\s+${BAL}[\u0627\u0623\u0622]\u0644\u0641`, 'gu');
    const RE_MILLION_W = new RegExp(`${AR_BL}(${NUM_WORD_PATTERN})\\s+${BAL}\u0645\u0644\u064A\u0648\u0646`, 'gu');
    const RE_DECIMAL_W = new RegExp(`${AR_BL}(${NUM_WORD_PATTERN})\\s+\u0641\u0627\u0635\u0644[\u0629\u0647]?\\s+(${NUM_WORD_PATTERN})${AR_BR}`, 'gu');
    const RE_DECIMAL_D = /(\d+)\s*\u0641\u0627\u0635\u0644[\u0629\u0647]?\s*(\d+)/g;
    const RE_DOT_D = /(\d+)\s*\u0646\u0642\u0637[\u0629\u0647]\s*(\d+)/g;
    const RE_PERCENT_D = /(\d+)\s+\u0628\u0627\u0644\u0645[\u0626\u064A][\u0629\u0647]/g;
    const RE_TENTH_D = /(\d+)\s+\u0628\u0627\u0644\s*\u0639\u0634\u0631[\u0629\u0647]?/g;
    const RE_THOUSAND_D = /(\d+)\s+\u0628\u0627\u0644\s*[\u0627\u0623\u0622]\u0644\u0641/g;
    const RE_MILLION_D = /(\d+)\s+\u0628\u0627\u0644\s*\u0645\u0644\u064A\u0648\u0646/g;
    const HAS_ARABIC_RE = /[\u0600-\u06FF]/;
    const HAS_DIGIT_RE = /\d/;

    /* ── Arabic Soundex ── */

    function arabicSoundex(text) {
        return text
            .replace(/[قك]/g, 'ك')
            .replace(/[سصث]/g, 'س')
            .replace(/[ذزظ]/g, 'ز')
            .replace(/[تط]/g, 'ت')
            .replace(/[هح]/g, 'ح')
            .replace(/[عأاإآ]/g, 'ا')
            .replace(/[ضد]/g, 'د')
            .replace(/[غخ]/g, 'خ');
    }

    /* ── Register Module ── */

    window.__voskLangModules['ar'] = {
        // Matches lang codes starting with 'ar'
        match: (langCode) => langCode.startsWith('ar'),

        normalize: normalizeArabic,

        soundex: arabicSoundex,

        postProcess(text) {
            if (!text) return text;

            if (HAS_ARABIC_RE.test(text)) {
                text = normalizeArabic(text);
                text = text.replace(RE_TENTH, (m, w) => {
                    const n = parseArabicNumber(w); return n !== null ? (n / 10).toString() : m;
                });
                text = text.replace(RE_PERCENT_W, (m, w) => {
                    const n = parseArabicNumber(w); return n !== null ? n + '%' : m;
                });
                text = text.replace(RE_THOUSAND_W, (m, w) => {
                    const n = parseArabicNumber(w); return n !== null ? (n / 1000).toString() : m;
                });
                text = text.replace(RE_MILLION_W, (m, w) => {
                    const n = parseArabicNumber(w); return n !== null ? (n / 1000000).toString() : m;
                });
                text = text.replace(RE_DECIMAL_W, (m, a, b) => {
                    const na = parseArabicNumber(a), nb = parseArabicNumber(b);
                    return (na !== null && nb !== null) ? `${na}.${nb}` : m;
                });

                text = text.replace(NUM_SEQUENCE_REGEX, (match, offset) => {
                    const num = parseArabicNumber(match);
                    if (num === null) return match;
                    const before = text.substring(0, offset);
                    const after = text.substring(offset + match.length);
                    const wordsBefore = before.trim().split(/\s+/).filter(Boolean).slice(-2);
                    const matchWords = match.trim().split(/\s+/).filter(Boolean);
                    const wordsAfter = after.trim().split(/\s+/).filter(Boolean).slice(0, 2);
                    const allWords = [...wordsBefore, ...matchWords, ...wordsAfter];
                    const mStart = wordsBefore.length;
                    const mEnd = mStart + matchWords.length;
                    return hasNumericContext(allWords, mStart, mEnd) ? num.toString() : match;
                });
            }

            if (HAS_DIGIT_RE.test(text)) {
                text = text.replace(RE_DECIMAL_D, '$1.$2');
                text = text.replace(RE_DOT_D, '$1.$2');
                text = text.replace(RE_PERCENT_D, '$1%');
                text = text.replace(RE_TENTH_D, (m, n) => (parseInt(n) / 10).toString());
                text = text.replace(RE_THOUSAND_D, (m, n) => (parseInt(n) / 1000).toString());
                text = text.replace(RE_MILLION_D, (m, n) => (parseInt(n) / 1000000).toString());
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
