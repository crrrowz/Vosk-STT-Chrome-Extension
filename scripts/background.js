// Background service worker for Vosk STT
// Handles chrome.commands, message routing, and on-demand content script injection

let activeRecordingTabId = null;
const injectedTabs = new Set(); // Track which tabs have content script injected

// On first install: set default engine to online
chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ engineMode: 'online' });
});

// ─── On-demand Content Script Injection ───

const RESTRICTED_RE = /^(chrome|edge|about|chrome-extension|devtools|file):\/\//;

async function injectContentScript(tabId, tabUrl) {
    if (tabUrl && RESTRICTED_RE.test(tabUrl)) return false;
    if (injectedTabs.has(tabId)) return true;

    try {
        // Try pinging first — script may already be there
        await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        injectedTabs.add(tabId);
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
            injectedTabs.add(tabId);
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
        const r = await chrome.storage.local.get(['fabAutoShow']);
        if (r?.fabAutoShow === false) return;
        await injectContentScript(tabId, tab.url);
    } catch (_err) { }
});

// Clean up injection tracking when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
    if (activeRecordingTabId === tabId) {
        activeRecordingTabId = null;
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

    return true;
});

// ─── Commands ───

chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    const injected = await injectContentScript(tab.id, tab.url);
    if (!injected) return;

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
