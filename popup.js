(() => {
    const toggleBtn = document.getElementById('toggleBtn');
    const pickBtn = document.getElementById('pickBtn');
    const langChips = document.querySelectorAll('.lang-chip');
    const splitToggle = document.getElementById('splitToggle');
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
    chrome.storage?.local?.get(['sttLang', 'splitFab'], (r) => {
        selectedLang = r?.sttLang || 'ar-IQ';
        langChips.forEach(c => {
            c.classList.toggle('active', c.dataset.lang === selectedLang);
        });
        if (splitToggle) splitToggle.checked = !!r?.splitFab;
    });

    // Check if FAB is visible to set toggle button text
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
        if (!tab) return;
        try {
            await ensureContentScript(tab.id, tab.url);
            chrome.tabs.sendMessage(tab.id, { action: 'checkFab' }, (response) => {
                if (response?.hasFab) {
                    toggleBtn.textContent = 'Hide Mic Button';
                }
            });
        } catch (e) {
            // Ignore errors here, just keep default text
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
            } catch (e) { }
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
            } catch (e) { }
        });
    }

    async function ensureContentScript(tabId, tabUrl) {
        if (tabUrl && RESTRICTED_RE.test(tabUrl)) {
            throw new Error('restricted');
        }
        try {
            await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        } catch (e) {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
            await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
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
        } catch (e) {
            showError('⚠️ Cannot run on this page');
        }
    });

    toggleBtn.addEventListener('click', async () => {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) return;
        try {
            await ensureContentScript(tab.id, tab.url);
            chrome.tabs.sendMessage(tab.id, { action: 'showFab' });
            window.close();
        } catch (e) {
            showError('⚠️ Cannot run on this page');
        }
    });
})();
