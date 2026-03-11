// Background service worker for Vosk STT
// Handles chrome.commands, message routing, and on-demand content script injection

// Issue 7: Use chrome.storage.session instead of in-memory vars that get lost on SW suspend
async function getInjectedTabs() {
    const data = await chrome.storage.session.get('injectedTabs');
    return new Set(data?.injectedTabs || []);
}

async function addInjectedTab(tabId) {
    const tabs = await getInjectedTabs();
    tabs.add(tabId);
    await chrome.storage.session.set({ injectedTabs: Array.from(tabs) });
}

async function removeInjectedTab(tabId) {
    const tabs = await getInjectedTabs();
    tabs.delete(tabId);
    await chrome.storage.session.set({ injectedTabs: Array.from(tabs) });
}

async function getActiveRecording() {
    const data = await chrome.storage.session.get('activeRecordingTabId');
    return data?.activeRecordingTabId || null;
}

async function setActiveRecording(tabId) {
    await chrome.storage.session.set({ activeRecordingTabId: tabId });
}

// On SW startup/install check
chrome.runtime.onInstalled.addListener(async () => {
    chrome.storage.local.set({ engineMode: 'online' });
    // Clean up session state
    await chrome.storage.session.set({ injectedTabs: [], activeRecordingTabId: null });
});

// Cleanup stale tabs on SW wake-up
(async function cleanupStaleSessionTabs() {
    try {
        const injected = await getInjectedTabs();
        const activeTabs = await chrome.tabs.query({});
        const activeIds = new Set(activeTabs.map(t => t.id));

        let changed = false;
        for (const tid of injected) {
            if (!activeIds.has(tid)) {
                injected.delete(tid);
                changed = true;
            }
        }
        if (changed) {
            await chrome.storage.session.set({ injectedTabs: Array.from(injected) });
        }
    } catch (_e) { }
})();

// ─── On-demand Content Script Injection ───

const RESTRICTED_RE = /^(chrome|edge|about|chrome-extension|devtools|file):\/\//;

async function injectContentScript(tabId, tabUrl) {
    if (tabUrl && RESTRICTED_RE.test(tabUrl)) return false;
    const injected = await getInjectedTabs();
    if (injected.has(tabId)) return true;

    try {
        // Try pinging first — script may already be there
        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        await addInjectedTab(tabId);
        return true;
    } catch (_err) {
        // Not injected yet, inject now
        try {
            await chrome.scripting.executeScript({
                target: { tabId },
                files: ['scripts/languages.js', 'scripts/content.js']
            });
            await chrome.scripting.insertCSS({
                target: { tabId },
                files: ['styles/content.css']
            });
            await new Promise(r => setTimeout(r, 150));
            await addInjectedTab(tabId);
            return true;
        } catch (_err2) {
            return false;
        }
    }
}

// Auto-inject on navigation when fabAutoShow is enabled
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete') return;
    if (!tab.url || RESTRICTED_RE.test(tab.url)) return;

    try {
        const r = await chrome.storage.local.get('fabAutoShow');
        if (r?.fabAutoShow === false) return;

        // Remove from set so we re-inject properly on reload
        await removeInjectedTab(tabId);
        await injectContentScript(tabId, tab.url);
    } catch (_err) { }
});

// Clean up injection tracking// Clean up tracked tabs on close
chrome.tabs.onRemoved.addListener(async (tabId) => {
    await removeInjectedTab(tabId);
    const activeId = await getActiveRecording();
    if (activeId === tabId) {
        await setActiveRecording(null);
    }
});

// ─── Stop Recording in a Tab ───

function stopTabRecording(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'stop' }, () => {
            if (chrome.runtime.lastError) { /* tab may be closed */ }
            resolve();
        });
    });
}

// ─── Message Handling ───

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'startRecordingFromTab') {
        const tabId = msg.tabId === 'self' && sender.tab ? sender.tab.id : msg.tabId;
        if (tabId) {
            (async () => {
                const activeId = await getActiveRecording();
                if (activeId && activeId !== tabId) {
                    try { await chrome.tabs.sendMessage(activeId, { action: 'stop' }); } catch (_e) { }
                }
                await setActiveRecording(tabId);
                sendResponse({ ok: true });
            })();
            return true;
        }
    }
    if (msg.action === 'stopped') {
        (async () => {
            const activeId = await getActiveRecording();
            if (sender.tab && sender.tab.id === activeId) {
                await setActiveRecording(null);
            }
            sendResponse({ ok: true });
        })();
        return true;
    }
    return true;
});

// ─── Keyboard Shortcuts ───

chrome.commands.onCommand.addListener(async (command) => {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab || RESTRICTED_RE.test(tab.url)) {
            console.warn('[Vosk STT] Cannot inject into this page (chrome://, edge://, etc.)');
            return;
        }

        const success = await injectContentScript(tab.id, tab.url);
        if (!success) {
            console.warn('[Vosk STT] Injection failed for tab', tab.id);
            return;
        }

        if (command === 'toggle-recording') {
            const activeId = await getActiveRecording();
            if (activeId && activeId !== tab.id) {
                await stopTabRecording(activeId);
            }
            await setActiveRecording(tab.id);
            await chrome.tabs.sendMessage(tab.id, { action: 'toggleRecording' });

        } else if (command === 'switch-language') {
            await chrome.tabs.sendMessage(tab.id, { action: 'switchLang' });

        } else if (command === 'pick-input') {
            await chrome.tabs.sendMessage(tab.id, { action: 'pickInput' });
        }
    } catch (err) {
        console.warn('[Vosk STT] Command failed:', err);
    }
});
