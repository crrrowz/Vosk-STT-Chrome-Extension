(() => {
    const toggleBtn = document.getElementById('toggleBtn');
    const pickBtn = document.getElementById('pickBtn');
    const langRow = document.getElementById('langRow');
    const splitToggle = document.getElementById('splitToggle');
    const autoShowToggle = document.getElementById('autoShowToggle');
    const cfg = window.VOSK_LANG_CONFIG;
    let selectedLang = cfg?.defaultLang || 'ar-IQ';

    const RESTRICTED_RE = /^(chrome|edge|about|chrome-extension|devtools|file):\/\//;

    // Dynamically generate language chips from shared registry
    function buildLangChips() {
        if (!langRow || !cfg) return;
        langRow.textContent = '';
        cfg.languages.forEach(lang => {
            const btn = document.createElement('button');
            btn.className = 'lang-chip' + (lang.code === selectedLang ? ' active' : '');
            btn.dataset.lang = lang.code;
            btn.textContent = lang.label;
            btn.addEventListener('click', async () => {
                langRow.querySelectorAll('.lang-chip').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                selectedLang = lang.code;
                chrome.storage?.local?.set({ sttLang: selectedLang });
                try {
                    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                    if (tab) chrome.tabs.sendMessage(tab.id, { action: 'setLang', lang: selectedLang });
                } catch (_err) { console.warn('[Vosk STT] setLang failed', _err); }
            });
            langRow.appendChild(btn);
        });
    }

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

    // ─── Insert Delay Slider ───
    const insertDelaySlider = document.getElementById('insertDelay');
    const delayValueLabel = document.getElementById('delayValue');

    function updateDelayLabel(val) {
        if (!delayValueLabel) return;
        delayValueLabel.textContent = val >= 1000 ? (val / 1000).toFixed(1) + 's' : val + 'ms';
    }

    if (insertDelaySlider) {
        insertDelaySlider.addEventListener('input', () => updateDelayLabel(+insertDelaySlider.value));
        insertDelaySlider.addEventListener('change', () => {
            chrome.storage?.local?.set({ insertDelay: +insertDelaySlider.value });
        });
    }

    // Load saved settings
    chrome.storage?.local?.get(['sttLang', 'splitFab', 'fabAutoShow', 'splitLangs', 'insertDelay'], (r) => {
        if (chrome.runtime.lastError) return;
        selectedLang = r?.sttLang || cfg?.defaultLang || 'ar-IQ';
        buildLangChips();
        if (splitToggle) splitToggle.checked = !!r?.splitFab;
        if (langRow) langRow.classList.toggle('hidden', !!r?.splitFab);
        if (autoShowToggle) autoShowToggle.checked = r?.fabAutoShow !== false;
        initSplitPicker(r?.splitLangs, !!r?.splitFab);
        if (insertDelaySlider && r?.insertDelay != null) {
            insertDelaySlider.value = r.insertDelay;
            updateDelayLabel(r.insertDelay);
        }
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
        } catch (_err) { /* Keep default text */ }
    });

    // ─── Split Language Picker ───
    const splitPicker = document.getElementById('splitPicker');
    const splitLang1 = document.getElementById('splitLang1');
    const splitLang2 = document.getElementById('splitLang2');
    const splitSwap = document.getElementById('splitSwap');

    function initSplitPicker(savedLangs, isEnabled) {
        if (!cfg || !splitLang1 || !splitLang2) return;
        const langs = cfg.languages;
        const defaults = savedLangs || [langs[0]?.code, langs[1]?.code || langs[0]?.code];

        [splitLang1, splitLang2].forEach(sel => {
            sel.textContent = '';
            langs.forEach(l => {
                const opt = document.createElement('option');
                opt.value = l.code;
                opt.textContent = `${l.short}`;
                sel.appendChild(opt);
            });
        });

        splitLang1.value = defaults[0];
        splitLang2.value = defaults[1];

        if (isEnabled && splitPicker) splitPicker.classList.add('visible');
    }

    function saveSplitLangs() {
        const pair = [splitLang1.value, splitLang2.value];
        chrome.storage?.local?.set({ splitLangs: pair });
        // Notify content script
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (tab) chrome.tabs.sendMessage(tab.id, { action: 'setSplitLangs', splitLangs: pair });
        });
    }

    if (splitLang1) splitLang1.addEventListener('change', saveSplitLangs);
    if (splitLang2) splitLang2.addEventListener('change', saveSplitLangs);
    if (splitSwap) {
        splitSwap.addEventListener('click', () => {
            const tmp = splitLang1.value;
            splitLang1.value = splitLang2.value;
            splitLang2.value = tmp;
            saveSplitLangs();
        });
    }

    // Split FAB toggle
    if (splitToggle) {
        splitToggle.addEventListener('change', async () => {
            const enabled = splitToggle.checked;
            chrome.storage?.local?.set({ splitFab: enabled });
            if (splitPicker) splitPicker.classList.toggle('visible', enabled);
            if (langRow) langRow.classList.toggle('hidden', enabled);
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) chrome.tabs.sendMessage(tab.id, { action: 'setSplit', split: enabled });
            } catch (_err) { console.warn('[Vosk STT] setSplit failed', _err); }
        });
    }

    // ROAD-01: Auto-show FAB toggle
    if (autoShowToggle) {
        autoShowToggle.addEventListener('change', () => {
            const isAuto = autoShowToggle.checked;
            chrome.storage?.local?.set({ fabAutoShow: isAuto });
            // Sync the manual toggle button text since the FAB will be auto-created/removed
            if (toggleBtn) {
                toggleBtn.textContent = isAuto ? '🎤 Hide Mic Button' : '🎤 Show Mic Button';
            }
        });
    }

    async function ensureContentScript(tabId, tabUrl) {
        if (tabUrl && RESTRICTED_RE.test(tabUrl)) {
            throw new Error('restricted');
        }
        try {
            await chrome.tabs.sendMessage(tabId, { action: 'ping' });
        } catch (_err) {
            await chrome.scripting.executeScript({ target: { tabId }, files: ['scripts/languages.js', 'scripts/content.js'] });
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
