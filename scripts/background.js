// Background service worker for Vosk STT
// Handles chrome.commands, offscreen doc management, and message bridging

// Track which tab is currently recording
let activeRecordingTabId = null;
let offscreenCreated = false;

// Force "online" engine on extension startup or reload
chrome.runtime.onStartup.addListener(() => {
    chrome.storage.local.set({ engineMode: 'online' });
});
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ engineMode: 'online' });
});

// Stop recording in a specific tab, returns a Promise
function stopTabRecording(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'stop' }, () => {
            if (chrome.runtime.lastError) { /* tab may be closed */ }
            resolve();
        });
    });
}

/* ───── Offscreen Document Management ───── */

async function ensureOffscreen() {
    if (offscreenCreated) return;
    try {
        // Check if already exists
        const contexts = await chrome.runtime.getContexts({
            contextTypes: ['OFFSCREEN_DOCUMENT']
        });
        if (contexts.length > 0) {
            offscreenCreated = true;
            return;
        }
    } catch (_e) { /* getContexts may not exist in older Chrome */ }

    try {
        await chrome.offscreen.createDocument({
            url: 'offscreen/offscreen.html',
            reasons: ['USER_MEDIA', 'AUDIO_PLAYBACK', 'WORKERS'],
            justification: 'Vosk WASM speech recognition requires mic access and WebWorker in cross-origin isolated context'
        });
        offscreenCreated = true;
        // Wait for offscreen doc scripts to initialize
        await new Promise(r => setTimeout(r, 500));
    } catch (err) {
        if (err.message?.includes('already exists')) {
            offscreenCreated = true;
        } else {
            console.error('[Vosk STT] Failed to create offscreen document:', err);
        }
    }
}

async function closeOffscreen() {
    if (!offscreenCreated) return;
    try {
        await chrome.offscreen.closeDocument();
    } catch (_e) { /* may already be closed */ }
    offscreenCreated = false;
}

/* ───── Message Handling ───── */

// ISSUE-13: Single consolidated onMessage listener
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Skip messages we forwarded to the offscreen doc (avoid recursive loop)
    if (msg.target === 'offscreen') return;

    // Messages from content script
    if (msg.action === 'stopped' && sender.tab) {
        if (activeRecordingTabId === sender.tab.id) {
            activeRecordingTabId = null;
        }
    }

    if (msg.action === 'startRecordingFromTab' && sender.tab?.id) {
        const tabId = sender.tab.id;
        (async () => {
            if (activeRecordingTabId && activeRecordingTabId !== tabId) {
                await stopTabRecording(activeRecordingTabId);
            }
            activeRecordingTabId = tabId;
        })();
    }

    // Offline engine: forward start/stop to offscreen document
    if (msg.action === 'vosk-offline-start') {
        (async () => {
            try {
                await ensureOffscreen();
                const resp = await chrome.runtime.sendMessage({
                    target: 'offscreen',
                    action: 'vosk-start',
                    lang: msg.lang,
                    modelUrl: msg.modelUrl,
                    modelPath: msg.modelPath,
                    modelId: msg.modelId
                });
                sendResponse(resp);
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true; // async
    }

    if (msg.action === 'vosk-offline-stop') {
        (async () => {
            try {
                const resp = await chrome.runtime.sendMessage({
                    target: 'offscreen',
                    action: 'vosk-stop'
                });
                sendResponse(resp);
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true;
    }

    if (msg.action === 'vosk-load-model') {
        (async () => {
            try {
                await ensureOffscreen();
                const resp = await chrome.runtime.sendMessage({
                    target: 'offscreen',
                    action: 'vosk-load-model',
                    modelUrl: msg.modelUrl,
                    modelPath: msg.modelPath,
                    modelId: msg.modelId
                });
                sendResponse(resp);
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true;
    }

    // Messages from offscreen document → forward to active recording tab
    if (msg.source === 'offscreen' && activeRecordingTabId) {
        // Forward as vosk-stt-event to the content script
        chrome.tabs.sendMessage(activeRecordingTabId, {
            action: 'vosk-offline-event',
            type: msg.type,
            data: msg
        }).catch(() => { /* tab may be closed */ });
    }

    return true;
});

/* ───── Commands ───── */

chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Ensure content script is injected
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch (_err) {
        try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['scripts/languages.js', 'scripts/content.js'] });
            await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['styles/content.css'] });
            await new Promise(r => setTimeout(r, 150));
        } catch (_err2) { return; }
    }

    switch (command) {
        case 'toggle-recording':
            if (activeRecordingTabId && activeRecordingTabId !== tab.id) {
                await stopTabRecording(activeRecordingTabId);
                activeRecordingTabId = null;
            }
            activeRecordingTabId = tab.id;
            chrome.tabs.sendMessage(tab.id, { action: 'toggleRecording' });
            break;
        case 'switch-language':
            chrome.tabs.sendMessage(tab.id, { action: 'switchLang' });
            break;
        case 'pick-input':
            chrome.tabs.sendMessage(tab.id, { action: 'pickInput' });
            break;
    }
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (activeRecordingTabId === tabId) {
        activeRecordingTabId = null;
    }
});
