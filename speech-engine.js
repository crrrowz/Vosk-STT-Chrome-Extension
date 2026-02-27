// Speech engine - runs in PAGE main world for mic access
// Re-injectable: cleans up old handlers on reload
(() => {
    'use strict';

    // Clean up previous version if exists
    if (window.__voskSttCleanup) {
        window.__voskSttCleanup();
    }

    let recognition = null;
    let shouldBeRunning = false;
    let currentLang = 'ar-IQ';
    let restartCount = 0;
    const MAX_RESTARTS = 50;

    /* ═══════════════════════════════════════════
       Compositional Arabic Number Parser
       ═══════════════════════════════════════════ */

    const UNITS = {
        'صفر': 0, 'واحد': 1, 'وحده': 1, 'وحدة': 1, 'اثنين': 2, 'اثنان': 2, 'ثنين': 2,
        'ثلاثة': 3, 'ثلاث': 3, 'اربعة': 4, 'أربعة': 4, 'اربع': 4, 'أربع': 4,
        'خمسة': 5, 'خمس': 5, 'ستة': 6, 'ست': 6,
        'سبعة': 7, 'سبع': 7, 'ثمانية': 8, 'ثمان': 8, 'ثماني': 8,
        'تسعة': 9, 'تسع': 9,
    };

    const TEENS = {
        'احد عشر': 11, 'أحد عشر': 11, 'حدعشر': 11, 'حداشر': 11,
        'اثني عشر': 12, 'اثنا عشر': 12, 'اثناعشر': 12, 'اثنعشر': 12,
        'ثلاث عشر': 13, 'ثلاثة عشر': 13, 'ثلاثعشر': 13, 'ثلطعشر': 13,
        'اربع عشر': 14, 'أربعة عشر': 14, 'اربعطعشر': 14, 'اربعتعشر': 14,
        'خمس عشر': 15, 'خمسة عشر': 15, 'خمسطعشر': 15, 'خمستعشر': 15,
        'ست عشر': 16, 'ستة عشر': 16, 'ستطعشر': 16, 'سطعشر': 16, 'ستاشر': 16,
        'سبع عشر': 17, 'سبعة عشر': 17, 'سبعطعشر': 17, 'سبعتعشر': 17,
        'ثمان عشر': 18, 'ثمانية عشر': 18, 'ثمنطعشر': 18, 'ثمانتعشر': 18,
        'تسع عشر': 19, 'تسعة عشر': 19, 'تسعطعشر': 19, 'تسعتعشر': 19,
    };

    const TENS = {
        'عشرة': 10, 'عشر': 10,
        'عشرين': 20, 'ثلاثين': 30, 'ثلثين': 30,
        'اربعين': 40, 'أربعين': 40,
        'خمسين': 50, 'ستين': 60,
        'سبعين': 70, 'ثمانين': 80, 'تسعين': 90,
    };

    const HUNDREDS = {
        'مئة': 100, 'مية': 100, 'مائة': 100, 'ميه': 100,
        'مئتين': 200, 'ميتين': 200, 'مئتان': 200,
        'ثلاثمئة': 300, 'ثلاثمية': 300, 'ثلثمية': 300,
        'اربعمئة': 400, 'أربعمئة': 400, 'اربعمية': 400,
        'خمسمئة': 500, 'خمسمية': 500,
        'ستمئة': 600, 'ستمية': 600,
        'سبعمئة': 700, 'سبعمية': 700,
        'ثمانمئة': 800, 'ثمانمية': 800, 'ثمنمية': 800,
        'تسعمئة': 900, 'تسعمية': 900,
    };

    const LARGE = {
        'الف': 1000, 'ألف': 1000, 'آلاف': 1000,
        'الفين': 2000, 'ألفين': 2000,
        'مليون': 1000000, 'ملايين': 1000000,
        'مليار': 1000000000, 'مليارات': 1000000000,
    };

    const ALL_NUM_WORDS = {};
    Object.assign(ALL_NUM_WORDS, UNITS, TEENS, TENS, HUNDREDS, LARGE);
    const SORTED_WORDS = Object.keys(ALL_NUM_WORDS).sort((a, b) => b.length - a.length);

    const NUM_WORD_PATTERN = SORTED_WORDS.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const NUM_SEQUENCE_REGEX = new RegExp(
        `(?:(?:${NUM_WORD_PATTERN})(?:\\s+و?\\s*|\\s*و\\s*))+(?:${NUM_WORD_PATTERN})`
        + `|(?:${NUM_WORD_PATTERN})`,
        'g'
    );

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

    // Pre-compiled regex patterns for postProcess (ISSUE-06 fix)
    const BAL = 'ب[اـ]?ل\\s*';
    const RE_TENTH = new RegExp(`(${NUM_WORD_PATTERN})\\s+${BAL}عشر[ةه]?`, 'g');
    const RE_PERCENT_W = new RegExp(`(${NUM_WORD_PATTERN})\\s+${BAL}م[ئي][ةه]`, 'g');
    const RE_THOUSAND_W = new RegExp(`(${NUM_WORD_PATTERN})\\s+${BAL}[اأآ]لف`, 'g');
    const RE_MILLION_W = new RegExp(`(${NUM_WORD_PATTERN})\\s+${BAL}مليون`, 'g');
    const RE_DECIMAL_W = new RegExp(`(${NUM_WORD_PATTERN})\\s+فاصل[ةه]?\\s+(${NUM_WORD_PATTERN})`, 'g');
    const RE_DECIMAL_D = /(\d+)\s*فاصل[ةه]?\s*(\d+)/g;
    const RE_DOT_D = /(\d+)\s*نقط[ةه]\s*(\d+)/g;
    const RE_PERCENT_D = /(\d+)\s+بالم[ئي][ةه]/g;
    const RE_TENTH_D = /(\d+)\s+بال\s*عشر[ةه]?/g;
    const RE_THOUSAND_D = /(\d+)\s+بال\s*[اأآ]لف/g;
    const RE_MILLION_D = /(\d+)\s+بال\s*مليون/g;

    function postProcess(text) {
        if (!text) return text;

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

        text = text.replace(NUM_SEQUENCE_REGEX, (match) => {
            const num = parseArabicNumber(match);
            return num !== null ? num.toString() : match;
        });

        text = text.replace(RE_DECIMAL_D, '$1.$2');
        text = text.replace(RE_DOT_D, '$1.$2');
        text = text.replace(RE_PERCENT_D, '$1%');
        text = text.replace(RE_TENTH_D, (m, n) => (parseInt(n) / 10).toString());
        text = text.replace(RE_THOUSAND_D, (m, n) => (parseInt(n) / 1000).toString());
        text = text.replace(RE_MILLION_D, (m, n) => (parseInt(n) / 1000000).toString());

        return text;
    }

    /* ───── Voice Commands (ROAD-07) ───── */

    const VOICE_COMMANDS = {
        // Arabic
        'سطر جديد': '\n', 'سطر': '\n', 'انتر': '\n',
        'فاصلة': '،', 'فارزة': '،',
        'نقطة': '.', 'نقطه': '.',
        'علامة استفهام': '؟', 'سؤال': '؟',
        'علامة تعجب': '!',
        'نقطتين': ':',
        'مسح الكل': '__CMD:clear',
        'تراجع': '__CMD:undo',
        'امسح': '__CMD:delete',
        // English
        'new line': '\n', 'next line': '\n', 'enter': '\n',
        'comma': ',',
        'period': '.', 'full stop': '.', 'dot': '.',
        'question mark': '?',
        'exclamation mark': '!', 'exclamation point': '!',
        'colon': ':',
        'semicolon': ';',
        'clear all': '__CMD:clear',
        'undo': '__CMD:undo', 'undo that': '__CMD:undo',
        'delete': '__CMD:delete', 'delete that': '__CMD:delete',
    };

    // Build sorted keys for matching (longest first)
    const CMD_KEYS = Object.keys(VOICE_COMMANDS).sort((a, b) => b.length - a.length);

    function processVoiceCommands(text) {
        if (!text) return text;
        const lower = text.trim().toLowerCase();
        for (const cmd of CMD_KEYS) {
            if (lower === cmd) return VOICE_COMMANDS[cmd];
        }
        return text;
    }

    /* ───── Command Handler ───── */

    function handleCommand(e) {
        const { command, lang } = e.detail;

        if (command === 'start') {
            shouldBeRunning = true;
            restartCount = 0;
            currentLang = lang || 'ar-IQ';
            startRecognition(currentLang);

        } else if (command === 'stop') {
            shouldBeRunning = false;
            stopRecognition();

        } else if (command === 'switchLang') {
            currentLang = currentLang.startsWith('ar') ? 'en-US' : 'ar-IQ';
            emit('langChanged', { lang: currentLang });
            if (shouldBeRunning) {
                restartCount = 0;
                if (recognition) { try { recognition.abort(); } catch (e) { } recognition = null; }
                startRecognition(currentLang);
            }
        }
    }

    document.addEventListener('vosk-stt-command', handleCommand);

    /* ───── Recognition ───── */

    function emit(type, data) {
        document.dispatchEvent(new CustomEvent('vosk-stt-event', {
            detail: { type, ...data }
        }));
    }

    function startRecognition(lang) {
        if (recognition) { try { recognition.abort(); } catch (e) { } recognition = null; }

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { emit('error', { error: 'unsupported' }); return; }

        recognition = new SR();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        let emittedLength = 0;

        recognition.onstart = () => emit('started', {});
        recognition.onaudiostart = () => emit('audiostart', {});
        recognition.onspeechstart = () => emit('speechstart', {});

        recognition.onresult = (event) => {
            let allFinal = '';
            let interim = '';

            for (let i = 0; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    allFinal += event.results[i][0].transcript;
                } else {
                    interim += event.results[i][0].transcript;
                }
            }

            const rawDelta = allFinal.substring(emittedLength).trim();

            // Check for voice commands first
            const cmdResult = rawDelta ? processVoiceCommands(rawDelta) : null;

            if (cmdResult && cmdResult.startsWith('__CMD:')) {
                // Emit command event for content.js to handle
                emit('voiceCommand', { command: cmdResult.substring(6) });
            } else {
                const processed = cmdResult && cmdResult !== rawDelta
                    ? cmdResult  // Voice command produced punctuation/newline
                    : (rawDelta ? postProcess(rawDelta) : '');

                emit('result', {
                    final: processed,
                    interim: interim,
                    preview: ''
                });
            }

            if (rawDelta) {
                emittedLength = allFinal.length;
            }
        };

        recognition.onerror = (event) => {
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            emit('error', { error: event.error });
            if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
                shouldBeRunning = false;
            }
        };

        recognition.onend = () => {
            recognition = null;
            if (shouldBeRunning && restartCount < MAX_RESTARTS) {
                restartCount++;
                setTimeout(() => { if (shouldBeRunning) startRecognition(currentLang); }, 200);
            } else if (shouldBeRunning) {
                shouldBeRunning = false;
                emit('stopped', {});
            } else {
                emit('stopped', {});
            }
        };

        try { recognition.start(); }
        catch (e) { emit('error', { error: 'start-failed', message: e.message }); }
    }

    function stopRecognition() {
        shouldBeRunning = false;
        if (recognition) { try { recognition.stop(); } catch (e) { } }
    }

    // Register cleanup for re-injection
    window.__voskSttCleanup = () => {
        stopRecognition();
        document.removeEventListener('vosk-stt-command', handleCommand);
    };

    console.log('[Vosk STT Engine] Ready ✓');
})();
