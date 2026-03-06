// Background service worker for Vosk STT
// Handles chrome.commands for global keyboard shortcuts

// Track which tab is currently recording
let activeRecordingTabId = null;

// Stop recording in a specific tab, returns a Promise
function stopTabRecording(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, { action: 'stop' }, () => {
            if (chrome.runtime.lastError) { /* tab may be closed */ }
            resolve();
        });
    });
}

// ISSUE-13: Single consolidated onMessage listener
chrome.runtime.onMessage.addListener((msg, sender) => {
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
});

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
