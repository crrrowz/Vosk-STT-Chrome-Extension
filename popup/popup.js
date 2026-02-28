(() => {
    const toggleBtn = document.getElementById('toggleBtn');
    const pickBtn = document.getElementById('pickBtn');
    const langChips = document.querySelectorAll('.lang-chip');
    const splitToggle = document.getElementById('splitToggle');
    const autoShowToggle = document.getElementById('autoShowToggle');
    let selectedLang = 'ar-IQ';

    const RESTRICTED_RE = /^(chrome|edge|about|chrome-extension|devtools|file):\/\//;

    function showError(msg) {
        let el = document.getElementById('vosk-popup-error');
        if (!el) {
            el = document.createElement('div');
            el.id = 'vosk-popup-error';
            el.style.cssText = 'color:#e13c5e;font-size:12px;text-align:center;padding:6px 0;';
            toggleBtn.parentNode.insertBefore(el, toggleBtn.nextSibling);
        }
        el.textContent = msg;
        setTimeout(() => el.remove(), 4000);
    }

    // Load saved settings
    chrome.storage?.local?.get(['sttLang', 'splitFab', 'fabAutoShow'], (r) => {
        if (chrome.runtime.lastError) return;
        selectedLang = r?.sttLang || 'ar-IQ';
        langChips.forEach(c => {
            c.classList.toggle('active', c.dataset.lang === selectedLang);
        });
        if (splitToggle) splitToggle.checked = !!r?.splitFab;
        // ROAD-01: Load auto-show preference (default true)
        if (autoShowToggle) autoShowToggle.checked = r?.fabAutoShow !== false;
    });

    // ISSUE-19: Check FAB state and sync button text
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
        if (!tab) return;
        try {
            await ensureContentScript(tab.id, tab.url);
            chrome.tabs.sendMessage(tab.id, { action: 'checkFab' }, (response) => {
                if (chrome.runtime.lastError) return;
                toggleBtn.textContent = response?.hasFab ? '🎤 Hide Mic Button' : '🎤 Show Mic Button';
            });
        } catch (_err) {
            // Keep default text
        }
    });

    // Language chip toggle
    langChips.forEach(chip => {
        chip.addEventListener('click', async () => {
            langChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            selectedLang = chip.dataset.lang;
            chrome.storage?.local?.set({ sttLang: selectedLang });
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) chrome.tabs.sendMessage(tab.id, { action: 'setLang', lang: selectedLang });
            } catch (_err) { console.warn('[Vosk STT] setLang failed', _err); }
        });
    });

    // Split FAB toggle
    if (splitToggle) {
        splitToggle.addEventListener('change', async () => {
            const enabled = splitToggle.checked;
            chrome.storage?.local?.set({ splitFab: enabled });
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) chrome.tabs.sendMessage(tab.id, { action: 'setSplit', split: enabled });
            } catch (_err) { console.warn('[Vosk STT] setSplit failed', _err); }
        });
    }

    // ROAD-01: Auto-show FAB toggle
    if (autoShowToggle) {
        autoShowToggle.addEventListener('change', () => {
            chrome.storage?.local?.set({ fabAutoShow: autoShowToggle.checked });
        });
    }

    async function ensureContentScript(tabId, tabUrl) {
        if (tabUrl && RESTRICTED_RE.test(tabUrl)) {
            throw new Error('restricted');
        }
        try {
            await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        } catch (_err) {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['scripts/content.js'] });
            await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles/content.css'] });
            await new Promise(r => setTimeout(r, 150));
        }
    }

    pickBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        try {
            await ensureContentScript(tab.id, tab.url);
            chrome.tabs.sendMessage(tab.id, { action: 'pickInput' });
            window.close();
        } catch (_err) {
            showError('⚠️ Cannot run on this page');
        }
    });

    // ISSUE-19: Toggle button text on click
    toggleBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        try {
            await ensureContentScript(tab.id, tab.url);
            // Check current state before toggling
            chrome.tabs.sendMessage(tab.id, { action: 'checkFab' }, (response) => {
                if (chrome.runtime.lastError) return;
                const willShow = !response?.hasFab;
                chrome.tabs.sendMessage(tab.id, { action: 'showFab' });
                toggleBtn.textContent = willShow ? '🎤 Hide Mic Button' : '🎤 Show Mic Button';
                setTimeout(() => window.close(), 150);
            });
        } catch (_err) {
            showError('⚠️ Cannot run on this page');
        }
    });
})();
