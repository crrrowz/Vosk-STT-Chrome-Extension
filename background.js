// Background service worker for Vosk STT
// Handles chrome.commands for global keyboard shortcuts
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
