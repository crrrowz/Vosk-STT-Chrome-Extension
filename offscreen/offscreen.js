// Offscreen document: bridges Chrome APIs ↔ sandboxed Vosklet iframe
// Handles mic capture, IndexedDB model storage, and Chrome message routing
(() => {
    'use strict';

    const sandbox = document.getElementById('sandbox');
    let sandboxReady = false;
    let isRunning = false;
    let audioCtx = null;
    let micStream = null;
    let audioWorkletNode = null;
    let pendingCallbacks = {};
    let callId = 0;

    // ─── Sandbox Communication ───

    function sendToSandbox(cmd, data = {}) {
        return new Promise((resolve, reject) => {
            const id = ++callId;
            pendingCallbacks[id] = { resolve, reject };
            sandbox.contentWindow.postMessage({ cmd, id, ...data }, '*');
            // Timeout after 30s
            setTimeout(() => {
                if (pendingCallbacks[id]) {
                    delete pendingCallbacks[id];
                    reject(new Error('Sandbox timeout'));
                }
            }, 30000);
        });
    }

    // Handle messages from sandbox iframe
    window.addEventListener('message', (ev) => {
        const msg = ev.data;
        if (!msg) return;

        // Event from sandbox (recognition results, status updates)
        if (msg.event) {
            if (msg.type === 'ready') {
                sandboxReady = true;
                console.log('[Vosk Offscreen] Sandbox ready');
                return;
            }
            // Forward to background.js
            chrome.runtime.sendMessage({
                source: 'offscreen',
                type: msg.type,
                ...msg
            });
            return;
        }

        // Response to a command
        if (msg.id && pendingCallbacks[msg.id]) {
            const cb = pendingCallbacks[msg.id];
            delete pendingCallbacks[msg.id];
            if (msg.ok) cb.resolve(msg);
            else cb.reject(new Error(msg.error || 'Sandbox error'));
        }
    });

    // Wait for sandbox to be ready and initialize it
    async function waitForSandbox() {
        if (!sandboxReady) {
            await new Promise((resolve) => {
                const check = setInterval(() => {
                    if (sandboxReady) { clearInterval(check); resolve(); }
                }, 50);
                setTimeout(() => { clearInterval(check); resolve(); }, 5000);
            });
        }

        // Initialize sandbox with worker scripts
        if (!sandbox.initialized) {
            const workerScript = await (await fetch('vosklet-worker.js')).text();
            const workletScript = await (await fetch('vosklet-worklet.js')).text();
            await sendToSandbox('init', { workerScript, workletScript });
            sandbox.initialized = true;
            console.log('[Vosk Offscreen] Sandbox initialized with worker scripts');
        }
    }

    // ─── IndexedDB Model Storage ───

    function openModelDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('vosk-models', 1);
            req.onupgradeneeded = () => req.result.createObjectStore('models');
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function getModelFromDB(key) {
        const db = await openModelDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('models', 'readonly');
            const req = tx.objectStore('models').get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    async function getModelData(modelPath) {
        let data = await getModelFromDB(modelPath);
        if (!data) throw new Error('Model not found in storage. Please re-select the model file.');

        // If data is a legacy Blob/File object, try to convert it
        // If the file permission was lost, this will throw NotReadableError
        if (data instanceof Blob) {
            try {
                data = await data.arrayBuffer();
            } catch (err) {
                if (err.name === 'NotReadableError') {
                    throw new Error('Saved model file is no longer accessible by the browser. Please click "Load Model" to select the .tar.gz file again.');
                }
                throw err;
            }
        }

        return data; // Guaranteed ArrayBuffer
    }

    // ─── Chrome Message Handling ───

    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg.target !== 'offscreen') return;
        console.log('[Vosk Offscreen] Received:', msg.action);

        switch (msg.action) {
            case 'vosk-start':
                handleStart(msg).then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: e.message }));
                return true;

            case 'vosk-stop':
                handleStop().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: true }));
                return true;

            case 'vosk-load-model':
                handleLoadModel(msg).then(r => sendResponse(r)).catch(e => sendResponse({ ok: false, error: e.message }));
                return true;

            case 'vosk-ping':
                sendResponse({ ok: true, running: isRunning });
                return true;
        }
    });

    // ─── Handlers ───

    async function handleLoadModel(msg) {
        await waitForSandbox();

        // Get model data from IndexedDB and send to sandbox
        const modelData = await getModelData(msg.modelPath);
        console.log('[Vosk Offscreen] Sending model data to sandbox (' + (modelData.byteLength / 1024 / 1024).toFixed(1) + ' MB)');

        await sendToSandbox('load-model', {
            modelBuffer: modelData,
            path: msg.modelPath,
            id: msg.modelId
        });

        console.log('[Vosk Offscreen] Model loaded OK');
        return { ok: true };
    }

    async function handleStart(msg) {
        if (isRunning) await handleStop();
        await waitForSandbox();

        // Load model if needed
        const modelData = await getModelData(msg.modelPath);
        await sendToSandbox('load-model', {
            modelBuffer: modelData,
            path: msg.modelPath,
            id: msg.modelId
        });

        // Get mic
        micStream = await navigator.mediaDevices.getUserMedia({
            video: false,
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 }
        });

        // HACK: Chrome silently stops background/offscreen mic streams (returning all 0s)
        // unless they are actively bound to an HTML5 media element.
        const dummyAudio = new Audio();
        dummyAudio.muted = true;
        dummyAudio.srcObject = micStream;
        dummyAudio.play().catch(() => { });

        audioCtx = new AudioContext();
        const source = audioCtx.createMediaStreamSource(micStream);

        // Create recognizer in sandbox
        await sendToSandbox('create-recognizer', { sampleRate: audioCtx.sampleRate });

        // Offscreen docs might create suspended AudioContexts. Force resume.
        if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
        }

        // Force audio graph to wake up with an inaudible oscillator
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        gain.gain.value = 0;
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();

        // Use AudioWorkletNode instead of deprecated ScriptProcessorNode
        try {
            await audioCtx.audioWorklet.addModule('recorder-worklet.js');
        } catch (err) {
            console.error('[Vosk Offscreen] Failed to load recorder-worklet.js:', err);
        }
        audioWorkletNode = new AudioWorkletNode(audioCtx, 'vosk-recorder-worklet');
        audioWorkletNode.onprocessorerror = (ev) => {
            console.error('[Vosk Offscreen] AudioWorklet Processor Error:', ev);
        };

        let chunkCount = 0;
        audioWorkletNode.port.onmessage = (ev) => {
            if (ev.data.type === 'log') {
                console.log(ev.data.message);
                return;
            }

            if (ev.data.type === 'audio') {
                chunkCount++;
                const float32Data = ev.data.data;

                // Send float32 array to sandbox
                sandbox.contentWindow.postMessage({
                    cmd: 'accept-waveform',
                    buffer: float32Data.buffer
                }, '*', [float32Data.buffer]);

                if (chunkCount === 1) {
                    console.log('[Vosk Offscreen] First audio chunk received from Worklet. Length:', float32Data.length, 'Sample:', float32Data[100]);
                }

                if (chunkCount % 50 === 0) {
                    // Check if buffer is completely silent
                    let isSilent = true;
                    for (let i = 0; i < float32Data.length; i += 100) {
                        if (float32Data[i] !== 0) { isSilent = false; break; }
                    }
                    if (isSilent) console.warn('[Vosk Offscreen] Warning: Audio buffer is completely silent! Mic might be blocked.');
                }
            }
        };

        source.connect(audioWorkletNode);
        audioWorkletNode.connect(audioCtx.destination);

        isRunning = true;
        chrome.runtime.sendMessage({ source: 'offscreen', type: 'started' });
        chrome.runtime.sendMessage({ source: 'offscreen', type: 'audiostart' });

        return { ok: true };
    }

    async function handleStop() {
        isRunning = false;

        if (audioWorkletNode) {
            try { audioWorkletNode.disconnect(); } catch (_e) { }
            audioWorkletNode = null;
        }

        if (micStream) {
            micStream.getTracks().forEach(t => t.stop());
            micStream = null;
        }

        if (audioCtx) {
            try { await audioCtx.close(); } catch (_e) { }
            audioCtx = null;
        }

        try { await sendToSandbox('delete-recognizer'); } catch (_e) { }

        chrome.runtime.sendMessage({ source: 'offscreen', type: 'stopped' });
    }
})();
