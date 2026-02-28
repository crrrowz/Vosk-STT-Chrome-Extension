// Background service worker for Vosk STT
// Handles chrome.commands for global keyboard shortcuts

// Track which tab is currently recording
let activeRecordingTabId = null;

// Listen for "stopped" messages from content scripts
chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === 'stopped' && sender.tab) {
        if (activeRecordingTabId === sender.tab.id) {
            activeRecordingTabId = null;
        }
    }
});

// Stop recording in a specific tab, returns a Promise
function stopTabRecording(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'stop' }, () => {
            // Ignore errors (tab might be closed)
            if (chrome.runtime.lastError) { /* noop */ }
            resolve();
        });
    });
}

chrome.commands.onCommand.addListener(async (command) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    // Ensure content script is injected
    try {
        await chrome.tabs.sendMessage(tab.id, { action: 'ping' });
    } catch (e) {
        try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
            await new Promise(r => setTimeout(r, 150));
        } catch (err) { return; }
    }

    switch (command) {
        case 'toggle-recording':
            // If another tab is recording, stop it first
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

// Also handle when recording is started from content script
chrome.runtime.onMessage.addListener((msg, sender) => {
    if (msg.action === 'startRecordingFromTab' && sender.tab?.id) {
        const tabId = sender.tab.id;
        (async () => {
            if (activeRecordingTabId && activeRecordingTabId !== tabId) {
                await stopTabRecording(activeRecordingTabId);
            }
            activeRecordingTabId = tabId;
        })();
    }
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    if (activeRecordingTabId === tabId) {
        activeRecordingTabId = null;
    }
});
