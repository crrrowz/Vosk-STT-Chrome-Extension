// Speech engine core - runs in PAGE main world for mic access
// Language modules are loaded separately from scripts/lang/*.js
// Re-injectable: cleans up old handlers on reload
(() => {
    'use strict';

    if (window.__voskSttCleanup) {
        window.__voskSttCleanup();
    }

    let recognition = null;
    let shouldBeRunning = false;
    let currentLang = 'ar-IQ';
    let restartCount = 0;
    let stopGeneration = 0;
    const MAX_RESTARTS = 50;

    /* ═══════════════════════════════════════════
       Language Module Registry
       ═══════════════════════════════════════════ */

    const modules = window.__voskLangModules || {};

    function getLangModule(langCode) {
        for (const mod of Object.values(modules)) {
            if (mod.match && mod.match(langCode)) return mod;
        }
        return null;
    }

    /* ═══════════════════════════════════════════
       Levenshtein + Fuzzy Matching (shared)
       ═══════════════════════════════════════════ */

    function levenshtein(a, b) {
        const m = a.length, n = b.length;
        if (m === 0) return n;
        if (n === 0) return m;
        let prev = Array.from({ length: n + 1 }, (_, i) => i);
        let curr = new Array(n + 1);
        for (let i = 1; i <= m; i++) {
            curr[0] = i;
            for (let j = 1; j <= n; j++) {
                curr[j] = a[i - 1] === b[j - 1]
                    ? prev[j - 1]
                    : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
            }
            [prev, curr] = [curr, prev];
        }
        return prev[n];
    }

    function fuzzySimilarity(input, target, mod) {
        const a = mod?.soundex ? mod.soundex(input) : input;
        const b = mod?.soundex ? mod.soundex(target) : target;
        const dist = levenshtein(a, b);
        return 1 - dist / Math.max(a.length, b.length, 1);
    }

    const FUZZY_THRESHOLD = 0.75;

    /* ═══════════════════════════════════════════
       Voice Command Processing
       ═══════════════════════════════════════════ */

    // Build command maps from all loaded language modules
    let CMD_ACTIONS = {};
    let PUNCTUATION = {};
    let CMD_KEYS = [];
    let PUNCT_KEYS = [];
    let PUNCT_REGEX = null;
    let _activeMod = null;

    function buildCommandMaps(langCode) {
        const mod = getLangModule(langCode);
        _activeMod = mod;
        CMD_ACTIONS = {};
        PUNCTUATION = {};

        const normalize = mod?.normalize || (t => t);
        const cmds = mod?.voiceCommands || {};

        for (const [rawKey, val] of Object.entries(cmds)) {
            const normKey = normalize(rawKey).toLowerCase();
            if (typeof val === 'string' && val.startsWith('__CMD:')) {
                CMD_ACTIONS[normKey] = val;
            } else {
                PUNCTUATION[normKey] = val;
            }
        }

        CMD_KEYS = Object.keys(CMD_ACTIONS).sort((a, b) => b.length - a.length);
        PUNCT_KEYS = Object.keys(PUNCTUATION).sort((a, b) => b.length - a.length);
        PUNCT_REGEX = PUNCT_KEYS.length > 0
            ? new RegExp('\\s*(' + PUNCT_KEYS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*', 'gi')
            : null;
    }

    // Initialize with default language
    buildCommandMaps(currentLang);

    function processVoiceCommands(text) {
        if (!text) return text;
        const mod = _activeMod;
        const normalize = mod?.normalize || (t => t);
        const trimmed = normalize(text.trim());
        const lower = trimmed.toLowerCase();

        // 1. Exact match
        for (const cmd of CMD_KEYS) {
            if (lower === cmd) return CMD_ACTIONS[cmd];
        }

        // 2. Fuzzy match (using language-specific soundex if available)
        let bestScore = 0, bestCmd = null;
        for (const cmd of CMD_KEYS) {
            const sim = fuzzySimilarity(lower, cmd, mod);
            if (sim > bestScore && sim >= FUZZY_THRESHOLD) {
                bestScore = sim;
                bestCmd = cmd;
            }
        }
        if (bestCmd) return CMD_ACTIONS[bestCmd];

        // 3. Inline replace punctuation
        if (PUNCT_REGEX) {
            const replaced = trimmed.replace(PUNCT_REGEX, (match) => {
                const key = match.trim().toLowerCase();
                return PUNCTUATION[key] || match;
            });
            return replaced;
        }

        return trimmed;
    }

    function postProcess(text) {
        if (!text) return text;
        const mod = _activeMod;
        return mod?.postProcess ? mod.postProcess(text) : text;
    }

    /* ═══════════════════════════════════════════
       Command Handler
       ═══════════════════════════════════════════ */

    function handleCommand(e) {
        const { command, lang } = e.detail;

        if (command === 'start') {
            shouldBeRunning = true;
            restartCount = 0;
            currentLang = lang || 'ar-IQ';
            buildCommandMaps(currentLang);
            startRecognition(currentLang);

        } else if (command === 'stop') {
            shouldBeRunning = false;
            stopRecognition();

        } else if (command === 'switchLang') {
            const langCfg = window.VOSK_LANG_CONFIG;
            currentLang = langCfg ? langCfg.getNextLang(currentLang)
                : (currentLang.startsWith('ar') ? 'en-US' : 'ar-IQ');
            buildCommandMaps(currentLang);
            emit('langChanged', { lang: currentLang });
            if (shouldBeRunning) {
                restartCount = 0;
                if (recognition) { try { recognition.abort(); } catch (_err) { } recognition = null; }
                startRecognition(currentLang);
            }
        }
    }

    document.addEventListener('vosk-stt-command', handleCommand);

    function emit(type, data) {
        document.dispatchEvent(new CustomEvent('vosk-stt-event', {
            detail: { type, ...data }
        }));
    }

    /* ═══════════════════════════════════════════
       Recognition Engine
       ═══════════════════════════════════════════ */

    function pickBestAlternative(result, lang) {
        let best = result[0];
        let bestScore = scoreAlt(best, lang);
        for (let a = 1; a < result.length; a++) {
            const s = scoreAlt(result[a], lang);
            if (s > bestScore) { best = result[a]; bestScore = s; }
        }
        return best;
    }

    function scoreAlt(alt, lang) {
        let score = alt.confidence || 0.5;
        const t = alt.transcript || '';
        if (t.trim().length < 2) score -= 0.3;
        if (lang.startsWith('ar')) {
            const arChars = (t.match(/[\u0600-\u06FF]/g) || []).length;
            score += (arChars / Math.max(t.length, 1)) * 0.15;
        }
        return score;
    }

    const MIN_CONFIDENCE = 0.3;

    function startRecognition(lang) {
        if (!shouldBeRunning) return;

        if (recognition) { try { recognition.abort(); } catch (_err) { } recognition = null; }

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { emit('error', { error: 'unsupported' }); return; }

        recognition = new SR();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;

        let emittedLength = 0;
        let lastInterim = '';
        let shortPauseTimer = null;
        const myGeneration = stopGeneration;

        recognition.onstart = () => emit('started', {});
        recognition.onaudiostart = () => emit('audiostart', {});
        recognition.onspeechstart = () => emit('speechstart', {});

        recognition.onresult = (event) => {
            clearTimeout(shortPauseTimer);

            let allFinal = '';
            let interim = '';

            for (let i = 0; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    const best = pickBestAlternative(event.results[i], lang);
                    if ((best.confidence || 1) < MIN_CONFIDENCE) {
                        emit('result', { final: '', interim: `⚠️ ${best.transcript}`, preview: '' });
                        continue;
                    }
                    allFinal += best.transcript;
                } else {
                    const best = pickBestAlternative(event.results[i], lang);
                    interim += best.transcript;
                }
            }

            const rawDelta = allFinal.substring(Math.min(emittedLength, allFinal.length)).trim();

            if (rawDelta) {
                lastInterim = '';
                emittedLength = allFinal.length;
                restartCount = 0; // successful result — reset restart budget

                const cmdResult = processVoiceCommands(rawDelta);
                if (cmdResult && cmdResult.startsWith('__CMD:')) {
                    emit('voiceCommand', { command: cmdResult.substring(6) });
                } else {
                    const processed = postProcess(cmdResult || rawDelta);
                    emit('result', { final: processed, interim: interim, preview: '' });
                }
            } else {
                lastInterim = interim;
                emit('result', { final: '', interim: interim, preview: '' });
            }

            if (interim.trim() && shouldBeRunning) {
                shortPauseTimer = setTimeout(() => {
                    if (recognition && shouldBeRunning) {
                        try { recognition.stop(); } catch (_err) { }
                    }
                }, 1500);
            }
        };

        recognition.onerror = (event) => {
            clearTimeout(shortPauseTimer);
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            emit('error', { error: event.error });
            if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
                shouldBeRunning = false;
            }
        };

        recognition.onend = async () => {
            clearTimeout(shortPauseTimer);

            const pendingInterim = lastInterim.trim();
            lastInterim = '';
            if (pendingInterim && myGeneration === stopGeneration && shouldBeRunning) {
                const cmdResult = processVoiceCommands(pendingInterim);
                if (cmdResult && cmdResult.startsWith('__CMD:')) {
                    emit('voiceCommand', { command: cmdResult.substring(6) });
                } else {
                    let finalRaw = postProcess(cmdResult || pendingInterim);

                    // Route through AI AIProcessor if available
                    if (aiProcessor.available) {
                        try {
                            finalRaw = await aiProcessor.process(finalRaw, currentLang);
                        } catch (e) {
                            console.error('AI Processing failed, falling back to raw', e);
                        }
                    }

                    emit('result', { final: finalRaw, interim: '', preview: '' });
                }
            }

            recognition = null;
            if (myGeneration !== stopGeneration) {
                emit('stopped', {});
                return;
            }
            if (shouldBeRunning && restartCount < MAX_RESTARTS) {
                restartCount++;
                setTimeout(() => {
                    if (shouldBeRunning && myGeneration === stopGeneration) {
                        startRecognition(currentLang);
                    }
                }, 200);
            } else if (shouldBeRunning) {
                shouldBeRunning = false;
                emit('stopped', {});
            } else {
                emit('stopped', {});
            }
        };

        try { recognition.start(); }
        catch (_err) { emit('error', { error: 'start-failed', message: _err.message }); }
    }

    /* ═══════════════════════════════════════════
       AI Post-Processor (Gemini Nano)
       ═══════════════════════════════════════════ */

    const aiProcessor = {
        session: null,
        available: false,
        initializing: false,
        lastContext: '',

        async init() {
            if (this.initializing || this.available) return;
            this.initializing = true;
            try {
                const ai = window.ai || self.ai;
                if (!ai?.languageModel) return;
                const caps = await ai.languageModel.capabilities();
                if (caps.available === 'no') return;

                this.session = await ai.languageModel.create({
                    systemPrompt: [
                        'You are an expert STT Post-Processor.',
                        'Task: Add punctuation, fix spelling, and convert spelled-out numbers to digits.',
                        'STRICT RULES:',
                        '- Do NOT change, add, or remove non-number words. Keep the meaning exactly the same.',
                        '- Do NOT translate. Keep the SAME language as the input.',
                        '- Convert written numbers to digits (e.g., "مئة وخمسين" -> "150").',
                        '- Context matters: "الف" in "الفسحة" is part of a word, do NOT convert it to 1000.',
                        '- Output ONLY the corrected text, nothing else.',
                        '- Use correct punctuation for the input language (Arabic: ، ؟ ؛)',
                    ].join('\n'),
                });
                this.available = true;
            } catch (_err) {
                // Not supported
            } finally {
                this.initializing = false;
            }
        },

        async process(text, langCode) {
            if (!this.available || !text.trim()) return text;
            try {
                const prompt = this.lastContext
                    ? `[Lang:${langCode}] Context: "${this.lastContext}"\nText: ${text}`
                    : `[Lang:${langCode}] ${text}`;
                const result = await this.session.prompt(prompt);
                let cleaned = (result || '').trim()
                    .replace(/^\[Lang:.*?\]\s*/g, '')
                    .replace(/^(Context|Text|Input|Output):\s*/gi, '')
                    .replace(/^"|"$/g, ''); // strip surrounding quotes if AI adds them
                if (!cleaned) return text;
                this.lastContext = cleaned.slice(-80);
                return cleaned;
            } catch (_err) {
                this.available = false;
                this.session = null;
                this.init();
                return text;
            }
        },
    };

    // Always init AI on engine load
    aiProcessor.init();

    /* ═══════════════════════════════════════════ */

    function stopRecognition() {
        shouldBeRunning = false;
        stopGeneration++;
        if (recognition) {
            try { recognition.abort(); } catch (_err) { }
            recognition = null;
        }
        emit('stopped', {});
    }

    window.__voskSttCleanup = () => {
        stopRecognition();
        document.removeEventListener('vosk-stt-command', handleCommand);
    };
})();
