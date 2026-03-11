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
    const MAX_RESTARTS = 50;
    let lastActivityTime = 0;
    let watchdogTimer = null;
    let pendingRestart = false;
    const WATCHDOG_INTERVAL = 10000;

    // Circuit breaker: track rapid restarts within a window
    let _restartTimestamps = [];
    const CIRCUIT_BREAKER_WINDOW = 30000; // 30s
    const CIRCUIT_BREAKER_MAX = 8;        // max restarts in window
    let _circuitBreakerCooldown = null;

    function isCircuitBroken() {
        const now = Date.now();
        _restartTimestamps = _restartTimestamps.filter(t => now - t < CIRCUIT_BREAKER_WINDOW);
        if (_restartTimestamps.length >= CIRCUIT_BREAKER_MAX) {
            console.warn(`[Vosk Engine] Circuit breaker: ${CIRCUIT_BREAKER_MAX} restarts in ${CIRCUIT_BREAKER_WINDOW / 1000}s, cooling down`);
            return true;
        }
        return false;
    }

    function recordRestart() {
        _restartTimestamps.push(Date.now());
    }

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

    const MIN_CONFIDENCE = 0.0; // Always insert text — user wants all speech captured

    let _engineMode = 'online';
    let _serverUrl = 'ws://localhost:8765';
    let _autoWinner = null; // 'online' | 'local' — set when first final result arrives in auto mode
    let _autoFinalLock = false; // Mutex: prevents concurrent final result processing
    let _autoSelectTimer = null; // 5s timeout to auto-select if only one engine responds
    let _autoOnlinePartials = 0; // Track partial result counts per engine
    let _autoLocalPartials = 0;

    // Issue 3: Nonce for postMessage authentication
    const _audioNonce = (document.getElementById('vosk-stt-engine')?.dataset?.audioNonce) || '';

    function startRecognition(lang) {
        if (!shouldBeRunning) return;

        if (_engineMode === 'auto') {
            // Race both engines — first final result wins
            _autoWinner = null;
            _autoFinalLock = false;
            clearTimeout(_autoSelectTimer);
            console.log('[Vosk Engine] AUTO mode: racing Online + Local');
            startLocalRecognition(lang, _serverUrl);
            startOnlineRecognition(lang);

            // Auto-select: track partial counts, pick winner after 5s
            _autoOnlinePartials = 0;
            _autoLocalPartials = 0;
            _autoSelectTimer = setTimeout(() => {
                if (_autoWinner || !shouldBeRunning) return;
                let winner = null;
                if (_autoOnlinePartials > 0 && _autoLocalPartials === 0) {
                    winner = 'online';
                } else if (_autoLocalPartials > 0 && _autoOnlinePartials === 0) {
                    winner = 'local';
                } else if (_autoOnlinePartials > 0 && _autoLocalPartials > 0) {
                    winner = 'online'; // prefer online when tied
                } else {
                    // Neither engine produced results
                    console.warn('[Vosk Engine] AUTO: neither engine produced results in 5s');
                    emit('error', { error: 'no-engine', message: 'No speech engine responded' });
                    return;
                }
                console.log(`[Vosk Engine] AUTO: 5s timeout, selecting ${winner} (online=${_autoOnlinePartials}, local=${_autoLocalPartials})`);
                _autoWinner = winner;
                emit('autoModeResolved', { winner });
                if (winner === 'online') {
                    stopLocalRecognition();
                } else {
                    if (recognition) { try { recognition.abort(); } catch (_e) { } recognition = null; }
                }
            }, 5000);
        } else if (_engineMode === 'offline') {
            startLocalRecognition(lang, _serverUrl);
        } else {
            startOnlineRecognition(lang);
        }
    }

    /**
     * In auto mode, check if this source should emit results.
     * Returns true if this source is allowed to emit.
     * Sets winner on first final result. Uses a mutex to prevent races.
     */
    function autoGate(source, isFinal) {
        if (_engineMode !== 'auto') return true; // not auto mode, always allow
        if (_autoWinner) return _autoWinner === source; // winner already decided

        if (isFinal) {
            // Mutex: only one final result can be processed at a time
            if (_autoFinalLock) return false; // another source is already being processed
            _autoFinalLock = true;

            _autoWinner = source;
            clearTimeout(_autoSelectTimer);
            console.log(`[Vosk Engine] AUTO winner: ${source}`);
            emit('autoModeResolved', { winner: source });

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
                        // Issue 5: Apply circuit breaker to local watchdog
                        localRestartCount++;
                        if (localRestartCount >= MAX_RESTARTS || isCircuitBroken()) {
                            console.error('[Vosk Engine] Local watchdog: circuit breaker tripped, stopping');
                            clearInterval(_localWatchdog);
                            _localWatchdog = null;
                            stopLocalRecognition();
                            if (_engineMode === 'auto') {
                                _autoWinner = 'online';
                                emit('autoModeResolved', { winner: 'online' });
                            } else {
                                emit('error', { error: 'server-unavailable', message: 'Vosk server not responding' });
                                setConnStatus('offline');
                            }
                            return;
                        }
                        recordRestart();
                        console.warn(`[Vosk Engine] Local watchdog: server stale, reconnecting (#${localRestartCount})`);
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
            _autoLocalPartials++; // Issue 2: track for auto-select
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

            // Try AudioWorklet first (runs on dedicated audio thread, no drops)
            let workletLoaded = false;
            if (localContext.audioWorklet) {
                try {
                    // Issue 4: Read worklet URL from data attribute (set by content.js)
                    const engineScript = document.getElementById('vosk-stt-engine');
                    const workletUrl = engineScript?.dataset?.workletUrl
                        || (engineScript?.src ? engineScript.src.replace('speech-engine.js', 'pcm-processor.js') : null);
                    if (!workletUrl) throw new Error('No worklet URL available');

                    await localContext.audioWorklet.addModule(workletUrl);
                    const workletNode = new AudioWorkletNode(localContext, 'pcm-processor');
                    workletNode.port.onmessage = (e) => {
                        if (!_localMicActive) return;
                        // Issue 3: Include nonce for authentication
                        window.postMessage({ __voskAudio: true, nonce: _audioNonce, buffer: e.data }, '*', [e.data]);
                    };
                    source.connect(workletNode);
                    workletNode.connect(localContext.destination);
                    localProcessor = workletNode;
                    workletLoaded = true;
                    console.log('[Vosk Engine] AudioWorklet mic capture active (zero main-thread blocking)');
                } catch (workletErr) {
                    console.warn('[Vosk Engine] AudioWorklet failed, falling back to ScriptProcessor:', workletErr.message);
                }
            }

            // Fallback: ScriptProcessorNode (deprecated but widely supported)
            if (!workletLoaded) {
                localProcessor = localContext.createScriptProcessor(2048, 1, 1);
                localProcessor.onaudioprocess = (e) => {
                    if (!_localMicActive) return;
                    const float32 = e.inputBuffer.getChannelData(0);
                    const pcm16 = new Int16Array(float32.length);
                    for (let i = 0; i < float32.length; i++) {
                        pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(float32[i] * 32767)));
                    }
                    window.postMessage({ __voskAudio: true, nonce: _audioNonce, buffer: pcm16.buffer }, '*', [pcm16.buffer]);
                };
                source.connect(localProcessor);
                localProcessor.connect(localContext.destination);
                console.log('[Vosk Engine] ScriptProcessor fallback mic capture active');
            }

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
            if (silentMs > WATCHDOG_INTERVAL * 3) {
                setConnStatus('slow');
                // Don't force-abort — let recognition end naturally
                // The Web Speech API will fire onend when it times out
            }
        }, WATCHDOG_INTERVAL);

        recognition.onstart = () => {
            console.log('[Vosk Engine] recognition.onstart fired');
            pendingRestart = false;
            // Do NOT reset onlineRestartCount here — only reset on actual speech
            emit('started', {});
        };
        recognition.onaudiostart = () => {
            console.log('[Vosk Engine] recognition.onaudiostart fired');
            emit('audiostart', {});
        };
        recognition.onspeechstart = () => {
            console.log('[Vosk Engine] recognition.onspeechstart fired');
            onlineRestartCount = 0; // Reset only when real speech is detected
            _restartTimestamps = []; // Clear circuit breaker on real speech
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
                    // Always accept text — never skip due to confidence
                    onlineRestartCount = 0; // Got real result, reset counter
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
                _autoOnlinePartials++; // Issue 2: track for auto-select
                lastInterim = interim;
                emit('result', { final: '', interim: interim, preview: '' });
            }

            // Issue 1: Removed shortPauseTimer — let Web Speech API manage
            // its own continuous mode pauses. The watchdog handles dead sessions.
        };

        recognition.onerror = (event) => {
            clearTimeout(shortPauseTimer);
            lastActivityTime = Date.now();
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            if (event.error === 'network') {
                networkErrorCount++;
                setConnStatus(networkErrorCount >= 3 ? 'offline' : 'slow');
                // Don't stop — let onend handle seamless restart
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

            // Flush any pending interim text as final — never lose speech
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

            // Seamless silent restart — keep capturing voice continuously
            if (shouldBeRunning) {
                // Check circuit breaker before restarting
                if (isCircuitBroken()) {
                    // Cool down: wait 10s then try again
                    if (!_circuitBreakerCooldown) {
                        setConnStatus('slow');
                        emit('result', { final: '', interim: 'Reconnecting...', preview: '' });
                        _circuitBreakerCooldown = setTimeout(() => {
                            _circuitBreakerCooldown = null;
                            _restartTimestamps = [];
                            onlineRestartCount = 0;
                            if (shouldBeRunning && myGeneration === stopGeneration) {
                                startRecognition(currentLang);
                            }
                        }, 10000);
                    }
                    return;
                }

                if (pendingRestart) return;
                pendingRestart = true;
                onlineRestartCount++;
                recordRestart();

                // Fast restart — minimal delay for seamless experience
                const delay = Math.min(200 * onlineRestartCount, 3000);
                setTimeout(() => {
                    pendingRestart = false;
                    if (shouldBeRunning && myGeneration === stopGeneration) {
                        if (_engineMode === 'auto') {
                            if (!_autoWinner || _autoWinner === 'online') {
                                startOnlineRecognition(currentLang);
                            }
                        } else {
                            startRecognition(currentLang);
                        }
                    }
                }, delay);
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
        _restartTimestamps = [];
        clearTimeout(_circuitBreakerCooldown);
        _circuitBreakerCooldown = null;
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
