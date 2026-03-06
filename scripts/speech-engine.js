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
    let onlineRestartCount = 0;
    let localRestartCount = 0;
    let stopGeneration = 0;
    const MAX_RESTARTS = 20;
    let lastActivityTime = 0;
    let watchdogTimer = null;
    let pendingRestart = false;
    const WATCHDOG_INTERVAL = 10000;

    // Local server mic state (WebSocket managed by content.js bridge)
    let localStream = null;
    let localProcessor = null;
    let localContext = null;

    /* ═══════════════════════════════════════════
       Connection Health Tracker
       ═══════════════════════════════════════════ */

    let connStatus = 'offline';   // 'connecting' | 'online' | 'slow' | 'offline'
    let recognitionStartTime = 0; // for latency measurement
    let firstResultReceived = false;
    let networkErrorCount = 0;
    const SLOW_THRESHOLD = 3000;  // ms — first result > 3s = slow

    function setConnStatus(status) {
        if (status === connStatus) return;
        console.log(`[Vosk Engine] Connection status: ${connStatus} → ${status}`);
        connStatus = status;
        emit('connectionStatus', { status });
    }

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
        const { command, lang, engineMode, voskServerUrl } = e.detail;

        if (command === 'start') {
            shouldBeRunning = true;
            currentLang = lang || 'ar-IQ';
            // Store engine config from content.js (has chrome.storage access)
            _engineMode = engineMode || 'online';
            _serverUrl = voskServerUrl || 'ws://localhost:8765';
            buildCommandMaps(currentLang);
            onlineRestartCount = 0;
            localRestartCount = 0;
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
                onlineRestartCount = 0;
                localRestartCount = 0;
                if (_engineMode === 'offline') {
                    // Reconfigure via bridge (mic stays active)
                    startLocalRecognition(currentLang, _serverUrl);
                } else if (_engineMode === 'auto') {
                    // Full restart to re-race both engines
                    stopLocalRecognition();
                    if (recognition) { try { recognition.abort(); } catch (_err) { } recognition = null; }
                    _autoWinner = null;
                    startRecognition(currentLang);
                } else {
                    if (recognition) { try { recognition.abort(); } catch (_err) { } recognition = null; }
                    startRecognition(currentLang);
                }
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

    let _engineMode = 'online';
    let _serverUrl = 'ws://localhost:8765';
    let _autoWinner = null; // 'online' | 'local' — set when first final result arrives in auto mode

    function startRecognition(lang) {
        if (!shouldBeRunning) return;

        if (_engineMode === 'auto') {
            // Race both engines — first final result wins
            _autoWinner = null;
            console.log('[Vosk Engine] AUTO mode: racing Online + Local');
            startLocalRecognition(lang, _serverUrl);
            startOnlineRecognition(lang);
        } else if (_engineMode === 'offline') {
            startLocalRecognition(lang, _serverUrl);
        } else {
            startOnlineRecognition(lang);
        }
    }

    /**
     * In auto mode, check if this source should emit results.
     * Returns true if this source is allowed to emit.
     * Sets winner on first final result.
     */
    function autoGate(source, isFinal) {
        if (_engineMode !== 'auto') return true; // not auto mode, always allow
        if (_autoWinner) return _autoWinner === source; // winner already decided
        if (isFinal) {
            _autoWinner = source;
            console.log(`[Vosk Engine] AUTO winner: ${source}`);
            // Stop the loser
            if (source === 'online') {
                stopLocalRecognition();
            } else {
                if (recognition) { try { recognition.abort(); } catch (_e) { } recognition = null; }
            }
        }
        return true; // before winner is decided, allow partials from both
    }

    /* ═══════════════════════════════════════════
       Local Server Mode (Mic → content.js bridge)
       WebSocket lives in content.js (extension CSP).
       speech-engine only captures mic and emits audio.
       ═══════════════════════════════════════════ */

    let _localMicActive = false;
    let _localWatchdog = null;

    async function startLocalRecognition(lang, serverUrl) {
        if (!shouldBeRunning) return;

        // If mic already active (language switch), just tell content.js to reconfigure
        if (_localMicActive) {
            console.log('[Vosk Engine] Mic active, requesting reconfigure for', lang);
            document.dispatchEvent(new CustomEvent('vosk-local-control', {
                detail: { action: 'configure', lang, sampleRate: 16000 }
            }));
            return;
        }

        stopLocalRecognition();
        setConnStatus('connecting');
        recognitionStartTime = Date.now();
        firstResultReceived = false;

        // Tell content.js to open WebSocket and configure
        document.dispatchEvent(new CustomEvent('vosk-local-control', {
            detail: { action: 'start', serverUrl, lang, sampleRate: 16000 }
        }));
    }

    // Listen for server messages forwarded by content.js
    function _handleServerMsg(e) {
        const msg = e.detail;
        if (!msg) return;
        lastActivityTime = Date.now();

        if (msg.type === 'status') {
            if (msg.status === 'ready') {
                console.log('[Vosk Engine] Server ready:', msg.msg);
                setConnStatus('online');
                recognitionStartTime = Date.now();
                // Start local watchdog
                clearInterval(_localWatchdog);
                _localWatchdog = setInterval(() => {
                    if (!_localMicActive || !shouldBeRunning) {
                        clearInterval(_localWatchdog);
                        _localWatchdog = null;
                        return;
                    }
                    const silentMs = Date.now() - lastActivityTime;
                    if (silentMs > WATCHDOG_INTERVAL * 3) {
                        console.warn('[Vosk Engine] Local watchdog: server stale, reconnecting');
                        clearInterval(_localWatchdog);
                        _localWatchdog = null;
                        stopLocalRecognition();
                        if (shouldBeRunning) startLocalRecognition(currentLang, _serverUrl);
                    }
                }, WATCHDOG_INTERVAL);
                if (!_localMicActive) startMicCapture();
            } else if (msg.status === 'error') {
                console.warn('[Vosk Engine] Server error:', msg.msg);
                if (_engineMode === 'auto') {
                    console.log('[Vosk Engine] AUTO: local unavailable, using online only');
                    _autoWinner = 'online';
                } else {
                    emit('error', { error: 'server-error', message: msg.msg });
                    setConnStatus('offline');
                }
            } else if (msg.status === 'stopped') {
                emit('stopped', {});
            } else if (msg.status === 'ws-closed') {
                stopLocalRecognition();
                if (shouldBeRunning && localRestartCount < MAX_RESTARTS) {
                    localRestartCount++;
                    const delay = Math.min(1000 * Math.pow(2, localRestartCount - 1), 10000);
                    console.log(`[Vosk Engine] Reconnecting local in ${delay}ms (#${localRestartCount})`);
                    setTimeout(() => {
                        if (shouldBeRunning) {
                            if (_engineMode === 'auto') {
                                startLocalRecognition(currentLang, _serverUrl);
                            } else {
                                startRecognition(currentLang);
                            }
                        }
                    }, delay);
                } else if (shouldBeRunning) {
                    emit('stopped', {});
                }
            } else if (msg.status === 'ws-error') {
                setConnStatus('offline');
            }
            return;
        }

        if (!firstResultReceived) {
            firstResultReceived = true;
            networkErrorCount = 0;
            const latency = Date.now() - recognitionStartTime;
            setConnStatus(latency > SLOW_THRESHOLD ? 'slow' : 'online');
        }

        if (msg.type === 'result' && msg.text) {
            if (!autoGate('local', true)) return;
            const cmdResult = processVoiceCommands(msg.text);
            if (cmdResult && cmdResult.startsWith('__CMD:')) {
                emit('voiceCommand', { command: cmdResult.substring(6) });
            } else {
                const processed = postProcess(cmdResult || msg.text);
                emit('result', { final: processed, interim: '', preview: '' });
            }
        } else if (msg.type === 'partial' && msg.text) {
            if (!autoGate('local', false)) return;
            emit('result', { final: '', interim: msg.text, preview: '' });
        }
    }
    document.addEventListener('vosk-server-msg', _handleServerMsg);

    async function startMicCapture() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true }
            });
            localContext = new AudioContext({ sampleRate: 16000 });
            const source = localContext.createMediaStreamSource(localStream);

            localProcessor = localContext.createScriptProcessor(2048, 1, 1);
            localProcessor.onaudioprocess = (e) => {
                if (!_localMicActive) return;
                const float32 = e.inputBuffer.getChannelData(0);
                const pcm16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                    pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
                }
                // Send audio to content.js which forwards to WebSocket
                document.dispatchEvent(new CustomEvent('vosk-audio-data', {
                    detail: pcm16.buffer
                }));
            };

            source.connect(localProcessor);
            localProcessor.connect(localContext.destination);

            _localMicActive = true;
            localRestartCount = 0;
            emit('started', {});
            console.log('[Vosk Engine] Mic capturing → content.js bridge');
        } catch (err) {
            console.error('[Vosk Engine] Mic access failed:', err);
            emit('error', { error: 'audio-capture', message: err.message });
            shouldBeRunning = false;
        }
    }

    function stopLocalRecognition() {
        _localMicActive = false;
        clearInterval(_localWatchdog);
        _localWatchdog = null;
        if (localProcessor) { try { localProcessor.disconnect(); } catch (_e) { } localProcessor = null; }
        if (localContext) { try { localContext.close(); } catch (_e) { } localContext = null; }
        if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
        // Tell content.js to close WebSocket
        document.dispatchEvent(new CustomEvent('vosk-local-control', {
            detail: { action: 'stop' }
        }));
    }

    /* ═══════════════════════════════════════════
       Online Mode (Web Speech API)
       ═══════════════════════════════════════════ */

    function startOnlineRecognition(lang) {
        if (!shouldBeRunning) return;

        if (recognition) { try { recognition.abort(); } catch (_err) { } recognition = null; }

        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { emit('error', { error: 'unsupported' }); return; }

        recognitionStartTime = Date.now();
        firstResultReceived = false;
        setConnStatus('connecting');

        recognition = new SR();
        recognition.lang = lang;
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;

        let emittedLength = 0;
        let lastInterim = '';
        let shortPauseTimer = null;
        const myGeneration = stopGeneration;

        lastActivityTime = Date.now();
        clearInterval(watchdogTimer);
        watchdogTimer = setInterval(() => {
            if (!shouldBeRunning || myGeneration !== stopGeneration) {
                clearInterval(watchdogTimer);
                watchdogTimer = null;
                return;
            }
            const silentMs = Date.now() - lastActivityTime;
            if (silentMs > WATCHDOG_INTERVAL * 2) {
                setConnStatus('offline');
            } else if (silentMs > WATCHDOG_INTERVAL) {
                setConnStatus('slow');
            }
            if (silentMs > WATCHDOG_INTERVAL && recognition) {
                console.warn(`[Vosk Engine] Watchdog: ${silentMs}ms silent, force-restarting (restart #${onlineRestartCount + 1})`);
                try { recognition.abort(); } catch (_e) { }
                recognition = null;
            }
        }, WATCHDOG_INTERVAL);

        recognition.onstart = () => {
            console.log('[Vosk Engine] recognition.onstart fired');
            pendingRestart = false;
            onlineRestartCount = 0;
            emit('started', {});
        };
        recognition.onaudiostart = () => {
            console.log('[Vosk Engine] recognition.onaudiostart fired');
            emit('audiostart', {});
        };
        recognition.onspeechstart = () => {
            console.log('[Vosk Engine] recognition.onspeechstart fired');
            onlineRestartCount = 0;
            emit('speechstart', {});
        };

        recognition.onresult = (event) => {
            clearTimeout(shortPauseTimer);
            lastActivityTime = Date.now();

            if (!firstResultReceived) {
                firstResultReceived = true;
                networkErrorCount = 0;
                const latency = Date.now() - recognitionStartTime;
                setConnStatus(latency > SLOW_THRESHOLD ? 'slow' : 'online');
            } else if (connStatus !== 'online') {
                setConnStatus('online');
            }

            let allFinal = '';
            let interim = '';

            for (let i = 0; i < event.results.length; i++) {
                if (event.results[i].isFinal) {
                    const best = pickBestAlternative(event.results[i], lang);
                    if ((best.confidence || 1) < MIN_CONFIDENCE) {
                        emit('result', { final: '', interim: `[low confidence] ${best.transcript}`, preview: '' });
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
                if (!autoGate('online', true)) return; // auto mode: local won, ignore
                lastInterim = '';
                emittedLength = allFinal.length;
                onlineRestartCount = 0;

                const cmdResult = processVoiceCommands(rawDelta);
                if (cmdResult && cmdResult.startsWith('__CMD:')) {
                    emit('voiceCommand', { command: cmdResult.substring(6) });
                } else {
                    const processed = postProcess(cmdResult || rawDelta);
                    emit('result', { final: processed, interim: interim, preview: '' });
                }
            } else {
                if (!autoGate('online', false)) return;
                lastInterim = interim;
                emit('result', { final: '', interim: interim, preview: '' });
            }

            if (interim.trim() && shouldBeRunning) {
                shortPauseTimer = setTimeout(() => {
                    if (recognition && shouldBeRunning) {
                        try { recognition.stop(); } catch (_err) { }
                    }
                }, 3000);
            }
        };

        recognition.onerror = (event) => {
            clearTimeout(shortPauseTimer);
            lastActivityTime = Date.now();
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            if (event.error === 'network') {
                networkErrorCount++;
                setConnStatus(networkErrorCount >= 3 ? 'offline' : 'slow');
                return;
            }
            emit('error', { error: event.error });
            if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
                shouldBeRunning = false;
            }
        };

        recognition.onend = () => {
            clearTimeout(shortPauseTimer);
            clearInterval(watchdogTimer);
            watchdogTimer = null;

            const pendingInterim = lastInterim.trim();
            lastInterim = '';
            if (pendingInterim && myGeneration === stopGeneration && shouldBeRunning && autoGate('online', true)) {
                const cmdResult = processVoiceCommands(pendingInterim);
                if (cmdResult && cmdResult.startsWith('__CMD:')) {
                    emit('voiceCommand', { command: cmdResult.substring(6) });
                } else {
                    let finalRaw = postProcess(cmdResult || pendingInterim);
                    emit('result', { final: finalRaw, interim: '', preview: '' });
                }
            }

            recognition = null;
            if (myGeneration !== stopGeneration) {
                emit('stopped', {});
                return;
            }
            if (shouldBeRunning && onlineRestartCount < MAX_RESTARTS) {
                if (pendingRestart) return;
                pendingRestart = true;
                onlineRestartCount++;
                const delay = Math.min(500 * Math.pow(2, onlineRestartCount - 1), 5000);
                setTimeout(() => {
                    pendingRestart = false;
                    if (shouldBeRunning && myGeneration === stopGeneration) {
                        // Auto mode: only restart online part (local is still running)
                        if (_engineMode === 'auto') {
                            if (!_autoWinner || _autoWinner === 'online') {
                                startOnlineRecognition(currentLang);
                            }
                            // If local won, no need to restart online
                        } else {
                            startRecognition(currentLang);
                        }
                    }
                }, delay);
            } else if (shouldBeRunning) {
                shouldBeRunning = false;
                emit('stopped', {});
            } else {
                setConnStatus('offline');
                emit('stopped', {});
            }
        };

        try {
            recognition.start();
        } catch (_err) {
            emit('error', { error: 'start-failed', message: _err.message });
        }
    }

    /* ═══════════════════════════════════════════ */

    function stopRecognition() {
        shouldBeRunning = false;
        pendingRestart = false;
        stopGeneration++;
        _autoWinner = null;
        onlineRestartCount = 0;
        localRestartCount = 0;
        clearInterval(watchdogTimer);
        watchdogTimer = null;
        stopLocalRecognition();
        if (recognition) {
            try { recognition.abort(); } catch (_err) { }
            recognition = null;
        }
        emit('stopped', {});
    }

    window.__voskSttCleanup = () => {
        stopRecognition();
        document.removeEventListener('vosk-stt-command', handleCommand);
        document.removeEventListener('vosk-server-msg', _handleServerMsg);
    };
})();
