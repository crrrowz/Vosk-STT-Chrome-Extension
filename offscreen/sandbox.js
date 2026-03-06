// Sandboxed Vosklet engine — runs inside iframe with unsafe-eval
// Communicates with parent offscreen.html via postMessage
(() => {
    'use strict';

    let voskModule = null;
    let voskModel = null;
    let recognizer = null;

    function reply(id, ok, data = {}) {
        parent.postMessage({ id, ok, ...data }, '*');
    }

    function emit(type, data) {
        parent.postMessage({ event: true, type, ...data }, '*');
    }

    async function initVosklet() {
        if (voskModule) return;
        console.log('[Vosk Sandbox] Loading Vosklet WASM...');
        voskModule = await loadVosklet();
        voskModule.setLogLevel(-1);
        console.log('[Vosk Sandbox] Vosklet WASM ready');
    }

    // Intercept fetch to serve model data from memory (sandbox can't fetch blob URLs)
    let pendingModelData = null;
    const _origFetch = window.fetch;
    window.fetch = function (url, opts) {
        const urlStr = typeof url === 'string' ? url : (url.url || String(url));
        if (urlStr.startsWith('blob:sandbox-fake-model-') && pendingModelData) {
            const data = pendingModelData;
            pendingModelData = null;
            console.log('[Vosk Sandbox] Intercepted fetch for model data');
            return Promise.resolve(new Response(data, {
                status: 200,
                headers: { 'Content-Type': 'application/gzip' }
            }));
        }

        // HACK: Vosklet.js hardcodes {credentials: "same-origin"} when fetching WASM.
        // Chrome sandboxed iframes (opaque origin) will throw TypeError: Failed to fetch
        // if same-origin credentials are forced. Strip it out.
        if (opts && typeof opts === 'object') {
            const newOpts = { ...opts };
            delete newOpts.credentials;
            return _origFetch.call(this, url, newOpts);
        }
        return _origFetch.call(this, url, opts);
    };

    async function loadModel(modelBuffer, path, id) {
        await initVosklet();

        if (voskModel && voskModel._path === path && voskModel._id === id) {
            return;
        }

        if (voskModel) {
            try { voskModel.delete(); } catch (_e) { }
            voskModel = null;
        }

        emit('connectionStatus', { status: 'connecting' });

        // Store data for fetch interception
        pendingModelData = modelBuffer;
        // Use a static string instead of URL.createObjectURL because
        // sandboxed iframes (opaque origin) throw DOMException on createObjectURL.
        const dummyUrl = 'blob:sandbox-fake-model-' + id;

        console.log('[Vosk Sandbox] Loading model (' + (modelBuffer.byteLength / 1024 / 1024).toFixed(1) + ' MB)...');

        // Vosklet's createModel calls fetch(dummyUrl) → intercepted → returns modelBuffer
        voskModel = await voskModule.createModel(dummyUrl, path, id);
        voskModel._path = path;
        voskModel._id = id;
        emit('connectionStatus', { status: 'online' });
        console.log('[Vosk Sandbox] Model loaded successfully');
    }

    async function createRecognizer(sampleRate) {
        if (!voskModel) throw new Error('No model loaded');
        await initVosklet();

        if (recognizer) {
            try { await recognizer.delete(false); } catch (_e) { }
            recognizer = null;
        }

        recognizer = await voskModule.createRecognizer(voskModel, sampleRate);

        recognizer.addEventListener('partialResult', (ev) => {
            const text = ev.detail?.partial || ev.detail?.text || '';
            // console.log('[Vosk Sandbox] Partial:', text);
            if (text) emit('result', { final: '', interim: text, preview: '' });
        });

        recognizer.addEventListener('result', (ev) => {
            const text = ev.detail?.text || '';
            console.log('[Vosk Sandbox] Result:', text);
            if (text && text.trim()) emit('result', { final: text.trim(), interim: '', preview: '' });
        });

        return true;
    }

    let waveformCount = 0;
    function acceptWaveform(float32Array) {
        if (recognizer) {
            waveformCount++;
            if (waveformCount % 50 === 0) {
                // console.log('[Vosk Sandbox] Processing audio chunks...', waveformCount);
            }
            recognizer.acceptWaveform(float32Array);
        }
    }

    async function deleteRecognizer() {
        if (recognizer) {
            try { await recognizer.delete(false); } catch (_e) { }
            recognizer = null;
        }
    }

    // Listen for commands from parent offscreen.html
    window.addEventListener('message', async (ev) => {
        const msg = ev.data;
        if (!msg || !msg.cmd) return;

        try {
            switch (msg.cmd) {
                case 'init':
                    // Create Blob URLs for the worker scripts and assign to globals mapped in Vosklet.js
                    window.VOSKLET_WORKER_URL = URL.createObjectURL(new Blob([msg.workerScript], { type: 'text/javascript' }));
                    window.VOSKLET_WORKLET_URL = URL.createObjectURL(new Blob([msg.workletScript], { type: 'text/javascript' }));

                    // Mock CacheStorage API because sandboxed iframes (opaque origin) throw SecurityError
                    Object.defineProperty(window, 'caches', {
                        value: {
                            open: async () => ({
                                keys: async () => [],
                                put: async () => { },
                                match: async () => undefined
                            })
                        },
                        configurable: true
                    });

                    reply(msg.id, true);
                    break;

                case 'load-model':
                    await loadModel(msg.modelBuffer, msg.path, msg.id);
                    reply(msg.id, true);
                    break;

                case 'create-recognizer':
                    await createRecognizer(msg.sampleRate);
                    reply(msg.id, true);
                    break;

                case 'accept-waveform':
                    acceptWaveform(new Float32Array(msg.buffer));
                    break;

                case 'delete-recognizer':
                    await deleteRecognizer();
                    reply(msg.id, true);
                    break;

                case 'ping':
                    reply(msg.id, true);
                    break;
            }
        } catch (err) {
            console.error('[Vosk Sandbox] Error:', msg.cmd, err);
            reply(msg.id, false, { error: err.message || String(err) });
        }
    });

    // Signal ready
    parent.postMessage({ event: true, type: 'ready' }, '*');
})();
