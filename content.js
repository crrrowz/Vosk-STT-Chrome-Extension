(() => {
    'use strict';

    let overlay = null;
    let targetInput = null;
    let lastFocusedInput = null;
    let hideTimeout = null;
    let pickerActive = false;
    let pickerHighlight = null;
    let isRecording = false;
    let fab = null;
    let currentLang = 'ar-IQ';
    let splitFab = false;
    let pendingLangStart = null;


    const LANG_LABELS = {
        'ar-IQ': 'عربي', 'ar-SA': 'عربي', 'ar': 'عربي', 'en-US': 'EN'
    };
    const LANG_SHORT = {
        'ar-IQ': 'AR', 'ar-SA': 'AR', 'ar': 'AR', 'en-US': 'EN'
    };

    /* ───── Inject Speech Engine ───── */

    let engineInjected = false;
    function injectSpeechEngine() {
        if (engineInjected) return;
        engineInjected = true;
        // Remove old script if present (stale from previous extension load)
        const old = document.getElementById('vosk-stt-engine');
        if (old) old.remove();
        const script = document.createElement('script');
        script.id = 'vosk-stt-engine';
        script.src = chrome.runtime.getURL('speech-engine.js');
        (document.head || document.documentElement).appendChild(script);
    }

    injectSpeechEngine();

    function sendEngineCommand(command, lang) {
        document.dispatchEvent(new CustomEvent('vosk-stt-command', {
            detail: { command, lang }
        }));
    }

    /* ───── FAB (Floating Action Button) ───── */

    function createFab() {
        if (fab) return;

        fab = document.createElement('button');
        fab.id = 'vosk-fab';
        renderFabContent();

        // Load saved position or default
        chrome.storage?.local?.get(['fabPosition'], (r) => {
            const pos = r?.fabPosition;
            fab.style.bottom = pos?.bottom || '24px';
            fab.style.right = pos?.right || '24px';
        });

        document.body.appendChild(fab);
        makeDraggable(fab);

        fab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // In split mode, clicks on the halves have their propagation stopped,
            // so this handler only triggers when clicking the central mic icon to play/pause.
            if (isRecording) {
                stopRecognition();
            } else {
                if (!chrome.runtime?.id) {
                    console.warn('Vosk STT: Extension context invalidated. Please refresh the page.');
                    removeFab();
                    return;
                }
                chrome.storage?.local?.get(['sttLang'], (r) => {
                    currentLang = r?.sttLang || 'ar-IQ';
                    updateFabLang();
                    startRecognition(currentLang);
                });
            }
        });
    }

    function renderFabContent() {
        if (!fab) return;
        if (splitFab) {
            fab.classList.add('split');
            fab.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z"/>
                    <path d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.93V22H13V18.93C16.39 18.43 19 15.53 19 12H17Z"/>
                </svg>
                <div id="vosk-fab-lang">${LANG_SHORT[currentLang] || 'AR'}</div>
                <div class="vosk-fab-half${currentLang === 'en-US' ? ' active-lang' : ''}" data-lang="en-US">EN</div>
                <div class="vosk-fab-half${currentLang.startsWith('ar') ? ' active-lang' : ''}" data-lang="ar-IQ">AR</div>
            `;
            // Attach click handlers to halves
            fab.querySelectorAll('.vosk-fab-half').forEach(half => {
                half.addEventListener('click', onHalfClick);
            });
        } else {
            fab.classList.remove('split');
            fab.innerHTML = `
                <svg viewBox="0 0 24 24">
                    <path d="M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z"/>
                    <path d="M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.93V22H13V18.93C16.39 18.43 19 15.53 19 12H17Z"/>
                </svg>
                <div id="vosk-fab-lang">${LANG_SHORT[currentLang] || 'AR'}</div>
            `;
        }
    }

    function onHalfClick(e) {
        e.preventDefault();
        e.stopPropagation();
        const half = e.target.closest('.vosk-fab-half');
        if (!half) return;
        const lang = half.dataset.lang;
        const isSameLang = (lang === currentLang) ||
            (lang === 'ar-IQ' && currentLang.startsWith('ar'));

        if (isRecording && isSameLang) {
            stopRecognition();
            return;
        }

        currentLang = lang;
        try {
            if (chrome.runtime?.id) chrome.storage?.local?.set({ sttLang: lang });
        } catch (e) { }

        updateSplitActive();

        if (isRecording) {
            pendingLangStart = lang;
            stopRecognition();
        } else {
            if (!chrome.runtime?.id) {
                console.warn('Vosk STT: Extension context invalidated. Please refresh the page.');
                removeFab();
                return;
            }
            startRecognition(lang);
        }
    }

    function updateSplitActive() {
        if (!fab) return;
        fab.querySelectorAll('.vosk-fab-half').forEach(h => {
            h.classList.toggle('active-lang', h.dataset.lang === currentLang ||
                (h.dataset.lang === 'ar-IQ' && currentLang.startsWith('ar')));
        });
    }

    function removeFab() {
        if (fab) {
            fab.remove();
            fab = null;
        }
    }

    function updateFabState() {
        if (!fab) return;
        if (isRecording) {
            fab.classList.add('recording');
        } else {
            fab.classList.remove('recording');
        }
    }

    function updateFabLang() {
        if (!fab) return;
        const badge = fab.querySelector('#vosk-fab-lang');
        if (badge) badge.textContent = LANG_SHORT[currentLang] || 'AR';
    }

    /* ───── Drag Logic ───── */

    function makeDraggable(el) {
        let isDragging = false;
        let startX, startY, initRight, initBottom;
        let hasMoved = false;

        el.addEventListener('mousedown', onDown);
        el.addEventListener('touchstart', onDown, { passive: false });

        function onDown(e) {
            if (!e.target.closest('#vosk-fab')) return;
            isDragging = true;
            hasMoved = false;
            const point = e.touches ? e.touches[0] : e;
            startX = point.clientX;
            startY = point.clientY;

            const rect = el.getBoundingClientRect();
            initRight = window.innerWidth - rect.right;
            initBottom = window.innerHeight - rect.bottom;

            el.style.transition = 'none';
            el.style.cursor = 'grabbing';

            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
            document.addEventListener('touchmove', onMove, { passive: false });
            document.addEventListener('touchend', onUp);

            if (e.touches) e.preventDefault();
        }

        function onMove(e) {
            if (!isDragging) return;
            const point = e.touches ? e.touches[0] : e;
            const dx = point.clientX - startX;
            const dy = point.clientY - startY;

            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) hasMoved = true;
            if (!hasMoved) return;

            let newRight = initRight - dx;
            let newBottom = initBottom - dy;

            // Clamp to viewport
            newRight = Math.max(4, Math.min(newRight, window.innerWidth - el.offsetWidth - 4));
            newBottom = Math.max(4, Math.min(newBottom, window.innerHeight - el.offsetHeight - 4));

            el.style.right = newRight + 'px';
            el.style.bottom = newBottom + 'px';
            el.style.left = '';
            el.style.top = '';

            if (e.touches) e.preventDefault();
        }

        function onUp() {
            isDragging = false;
            el.style.cursor = 'grab';
            el.style.transition = '';

            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.removeEventListener('touchmove', onMove);
            document.removeEventListener('touchend', onUp);

            // Update wasDragged for click handler
            if (hasMoved) {
                // Block the upcoming click
                el.addEventListener('click', blockClick, { once: true, capture: true });
                // Save position (ISSUE-13)
                try {
                    chrome.storage?.local?.set({ fabPosition: { bottom: el.style.bottom, right: el.style.right } });
                } catch (e) { }
            }
        }

        function blockClick(e) {
            e.stopImmediatePropagation();
            e.preventDefault();
        }
    }

    /* ───── Track Last Focused Input ───── */

    function isInputElement(el) {
        if (!el) return false;
        if (el.id === 'vosk-fab' || el.id === 'vosk-stt-overlay') return false;
        if (el.tagName === 'INPUT' && ['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''].includes(el.type)) return true;
        if (el.tagName === 'TEXTAREA') return true;
        if (el.isContentEditable) return true;
        if (el.getAttribute && el.getAttribute('role') === 'textbox') return true;
        return false;
    }

    document.addEventListener('focusin', (e) => {
        if (isInputElement(e.target)) {
            lastFocusedInput = e.target;
        }
    }, true);

    if (isInputElement(document.activeElement)) {
        lastFocusedInput = document.activeElement;
    }

    let speakingTimeout = null;

    function setSpeaking(active) {
        if (!overlay) return;
        const card = overlay.querySelector('.vosk-stt-card');
        if (!card) return;
        clearTimeout(speakingTimeout);
        if (active) {
            card.classList.add('speaking');
        } else {
            speakingTimeout = setTimeout(() => card.classList.remove('speaking'), 800);
        }
    }

    document.addEventListener('vosk-stt-event', (e) => {
        const { type, ...data } = e.detail;

        switch (type) {
            case 'started':
                updateOverlayText('', '🎤 Speak now...');
                setSpeaking(false);
                break;

            case 'audiostart':
                updateOverlayText('', '🎤 Listening...');
                break;

            case 'speechstart':
                updateOverlayText('', '🎤 Speech detected...');
                setSpeaking(true);
                break;

            case 'result': {
                // Show ONLY interim text in the overlay
                updateOverlayText('', data.interim || '🎤 Speak now...');

                // Waves active when there's interim text (user is speaking)
                setSpeaking(!!data.interim);

                // Insert delta immediately
                if (data.final && data.final.trim()) {
                    const textToInsert = data.final.trim();
                    const target = targetInput || resolveTargetInput();
                    if (target) {
                        insertText(target, textToInsert);
                    }
                }
                break;
            }

            case 'info':
                updateOverlayText('', data.message || '');
                break;

            case 'langChanged':
                currentLang = data.lang;
                updateFabLang();
                const lbl = LANG_LABELS[data.lang] || data.lang;
                updateOverlayLabel(lbl);
                break;

            case 'error': {
                const msgs = {
                    'not-allowed': '⚠️ Allow microphone',
                    'service-not-allowed': '⚠️ Service unavailable',
                    'no-speech': '🔇 No speech',
                    'audio-capture': '⚠️ No microphone',
                    'network': '⚠️ Network error',
                    'unsupported': '⚠️ Not supported',
                };
                updateOverlayText('', msgs[data.error] || `⚠️ ${data.error}`);
                if (!['no-speech', 'aborted'].includes(data.error)) {
                    setTimeout(hideOverlay, 3000);
                }
                break;
            }

            case 'voiceCommand': {
                const target = targetInput || resolveTargetInput();
                if (!target) break;
                target.focus();

                if (data.command === 'clear') {
                    if (target.isContentEditable || target.getAttribute?.('role') === 'textbox') {
                        target.textContent = '';
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
                        setter ? setter.call(target, '') : (target.value = '');
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    updateOverlayText('', '🗑️ Cleared');
                } else if (data.command === 'undo' || data.command === 'delete') {
                    if (target.isContentEditable || target.getAttribute?.('role') === 'textbox') {
                        const text = target.textContent || '';
                        const words = text.trimEnd().split(/\s+/);
                        if (words.length > 0) words.pop();
                        target.textContent = words.join(' ') + (words.length ? ' ' : '');
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                    } else {
                        const text = target.value || '';
                        const words = text.trimEnd().split(/\s+/);
                        if (words.length > 0) words.pop();
                        const nv = words.join(' ') + (words.length ? ' ' : '');
                        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(target), 'value')?.set;
                        setter ? setter.call(target, nv) : (target.value = nv);
                        target.selectionStart = target.selectionEnd = nv.length;
                        target.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                    updateOverlayText('', '↩️ Deleted last word');
                }
                setSpeaking(false);
                break;
            }

            case 'stopped':
                if (!isRecording && !pendingLangStart) break; // Already stopped, ignore duplicate
                isRecording = false;
                updateFabState();
                hideOverlay();
                try { chrome.runtime.sendMessage({ action: 'stopped' }); } catch (e) { }
                if (pendingLangStart) {
                    const nextLang = pendingLangStart;
                    pendingLangStart = null;
                    setTimeout(() => startRecognition(nextLang), 100);
                }
                break;
        }
    });

    /* ───── Input Picker ───── */

    function startPicker() {
        pickerActive = true;
        pickerHighlight = document.createElement('div');
        pickerHighlight.id = 'vosk-picker-highlight';
        pickerHighlight.style.cssText = `
            position: fixed; z-index: 2147483646;
            pointer-events: none; border: 2px solid #6C3CE1;
            border-radius: 6px; background: rgba(108,60,225,0.08);
            box-shadow: 0 0 0 2000px rgba(0,0,0,0.15);
            transition: all 0.15s ease; display: none;
        `;
        document.body.appendChild(pickerHighlight);

        const badge = document.createElement('div');
        badge.id = 'vosk-picker-badge';
        badge.textContent = '🎯 Click the target input field';
        badge.style.cssText = `
            position: fixed; top: 16px; left: 50%; transform: translateX(-50%);
            z-index: 2147483647; padding: 10px 20px; border-radius: 10px;
            background: rgba(15,15,26,0.95); color: #e4e4f0;
            font-family: 'Segoe UI', sans-serif; font-size: 14px; font-weight: 600;
            border: 1px solid rgba(108,60,225,0.4);
            box-shadow: 0 8px 24px rgba(0,0,0,0.4);
            backdrop-filter: blur(12px); direction: ltr;
        `;
        document.body.appendChild(badge);
        document.addEventListener('mousemove', onPickerHover, true);
        document.addEventListener('click', onPickerClick, true);
        document.addEventListener('keydown', onPickerEscape, true);
    }

    function stopPicker() {
        pickerActive = false;
        document.removeEventListener('mousemove', onPickerHover, true);
        document.removeEventListener('click', onPickerClick, true);
        document.removeEventListener('keydown', onPickerEscape, true);
        document.getElementById('vosk-picker-highlight')?.remove();
        document.getElementById('vosk-picker-badge')?.remove();
        pickerHighlight = null;
        document.body.style.cursor = '';
    }

    function onPickerHover(e) {
        if (!pickerActive || !pickerHighlight) return;
        if (isInputElement(e.target)) {
            const r = e.target.getBoundingClientRect();
            Object.assign(pickerHighlight.style, { display: 'block', top: r.top + 'px', left: r.left + 'px', width: r.width + 'px', height: r.height + 'px' });
            document.body.style.cursor = 'crosshair';
        } else {
            pickerHighlight.style.display = 'none';
            document.body.style.cursor = '';
        }
    }

    function onPickerClick(e) {
        if (!pickerActive) return;
        e.preventDefault();
        e.stopPropagation();
        if (isInputElement(e.target)) {
            targetInput = e.target;
            lastFocusedInput = e.target;
            e.target.focus();
            stopPicker();
        }
    }

    function onPickerEscape(e) {
        if (e.key === 'Escape') stopPicker();
    }

    /* ───── Overlay ───── */

    function createOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'vosk-stt-overlay';
        overlay.innerHTML = `
      <div class="vosk-stt-card">
        <div class="vosk-stt-header">
          <div class="vosk-stt-dot"></div>
          <span class="vosk-stt-label">Listening...</span>
          <div class="vosk-stt-waves">
            <div class="vosk-stt-wave"></div><div class="vosk-stt-wave"></div>
            <div class="vosk-stt-wave"></div><div class="vosk-stt-wave"></div>
            <div class="vosk-stt-wave"></div>
          </div>
        </div>
        <div class="vosk-stt-text"><span class="partial">🎤 Speak now...</span></div>
      </div>`;
        document.body.appendChild(overlay);
        return overlay;
    }

    function positionOverlay() {
        if (!overlay) return;
        // Always position above the FAB (bottom-right)
        if (fab) {
            const fabRect = fab.getBoundingClientRect();
            const oh = overlay.offsetHeight || 80;
            const ow = overlay.offsetWidth || 300;
            const top = fabRect.top - oh - 12;
            const right = window.innerWidth - fabRect.right;
            Object.assign(overlay.style, {
                position: 'fixed',
                top: (top > 0 ? top : 8) + 'px',
                right: Math.max(8, right) + 'px',
                bottom: '', left: ''
            });
        } else {
            Object.assign(overlay.style, { position: 'fixed', bottom: '90px', right: '24px', top: '', left: '' });
        }
    }

    function showOverlay() {
        createOverlay();
        positionOverlay();
        clearTimeout(hideTimeout);
        overlay.classList.remove('fade-out');
        void overlay.offsetWidth;
        overlay.classList.add('visible');
    }

    function updateOverlayLabel(text) {
        if (!overlay) return;
        const label = overlay.querySelector('.vosk-stt-label');
        if (label) label.textContent = text;
    }

    function hideOverlay() {
        if (!overlay) return;
        overlay.classList.remove('visible');
        overlay.classList.add('fade-out');
        hideTimeout = setTimeout(() => {
            overlay?.remove();
            overlay = null;
        }, 500);
    }

    function updateOverlayText(final, partial) {
        if (!overlay) return;
        const el = overlay.querySelector('.vosk-stt-text');
        if (!el) return;
        el.textContent = '';
        if (final) {
            const s = document.createElement('span');
            s.className = 'final';
            s.textContent = final;
            el.appendChild(s);
        }
        if (partial) {
            const s = document.createElement('span');
            s.className = 'partial';
            s.textContent = (final ? ' ' : '') + partial;
            el.appendChild(s);
        }
        if (!final && !partial) {
            const s = document.createElement('span');
            s.className = 'partial';
            s.textContent = '🎤 Speak now...';
            el.appendChild(s);
        }
        positionOverlay();
    }

    /* ───── Input Resolution & Text Insertion ───── */

    function resolveTargetInput() {
        if (targetInput && document.body.contains(targetInput)) return targetInput;
        if (lastFocusedInput && document.body.contains(lastFocusedInput)) return lastFocusedInput;
        const el = document.activeElement;
        if (el && isInputElement(el)) return el;
        const inputs = document.querySelectorAll('input[type="text"],input[type="search"],input:not([type]),textarea,[contenteditable="true"],[role="textbox"]');
        for (const inp of inputs) {
            const r = inp.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight) return inp;
        }
        return null;
    }

    function insertText(el, text) {
        if (!el || !text) return;
        el.focus();
        if (el.isContentEditable || el.getAttribute?.('role') === 'textbox') {
            // Safely move cursor to end WITHOUT selecting all text
            const sel = window.getSelection();
            const range = document.createRange();

            // Find deepest last text node (O(depth) instead of O(n))
            let lastNode = el;
            while (lastNode.lastChild) {
                if (lastNode.lastChild.nodeType === Node.TEXT_NODE) { lastNode = lastNode.lastChild; break; }
                lastNode = lastNode.lastChild;
            }

            if (lastNode !== el && lastNode.nodeType === Node.TEXT_NODE) {
                range.setStart(lastNode, lastNode.length);
                range.collapse(true);
            } else {
                range.selectNodeContents(el);
                range.collapse(false); // collapse to end
            }
            sel.removeAllRanges();
            sel.addRange(range);

            const existing = el.textContent || '';
            const sep = existing && !existing.endsWith(' ') ? ' ' : '';
            if (!document.execCommand('insertText', false, sep + text)) {
                // Fallback: append text node
                el.appendChild(document.createTextNode(sep + text));
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else {
            // Always append at end, ignore selection
            const existing = el.value || '';
            const sep = existing && !existing.endsWith(' ') ? ' ' : '';
            const nv = existing + sep + text;
            const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
            setter ? setter.call(el, nv) : (el.value = nv);
            el.selectionStart = el.selectionEnd = nv.length;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    /* ───── Start / Stop ───── */

    function startRecognition(lang) {
        targetInput = resolveTargetInput();
        isRecording = true;
        updateFabState();
        showOverlay();
        // Notify background to stop any other tab's recording
        try {
            chrome.runtime.sendMessage({ action: 'startRecordingFromTab', tabId: 'self' });
        } catch (e) { }
        setTimeout(() => sendEngineCommand('start', lang), 100);
    }

    function stopRecognition() {
        sendEngineCommand('stop');
        // State cleanup handled by 'stopped' event handler
    }

    /* ───── Chrome Message Listener ───── */

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
        if (msg.action === 'ping') { sendResponse({ ok: true }); return true; }
        if (msg.action === 'checkFab') {
            sendResponse({ hasFab: !!fab });
            return true;
        }
        if (msg.action === 'showFab') {
            if (fab) {
                removeFab();
                sendResponse({ ok: true });
            } else {
                chrome.storage?.local?.get(['sttLang', 'splitFab'], (r) => {
                    currentLang = r?.sttLang || 'ar-IQ';
                    splitFab = !!r?.splitFab;
                    createFab();
                    updateFabLang();
                    sendResponse({ ok: true });
                });
            }
        } else if (msg.action === 'setLang') {
            currentLang = msg.lang || 'ar-IQ';
            updateFabLang();
            updateSplitActive();
            sendResponse({ ok: true });
        } else if (msg.action === 'setSplit') {
            splitFab = !!msg.split;
            if (fab) renderFabContent();
            sendResponse({ ok: true });
        } else if (msg.action === 'pickInput') {
            startPicker();
            sendResponse({ ok: true });
        } else if (msg.action === 'start') {
            currentLang = msg.lang || 'ar-IQ';
            createFab();
            startRecognition(currentLang);
            sendResponse({ ok: true });
        } else if (msg.action === 'stop') {
            stopRecognition();
            sendResponse({ ok: true });
        } else if (msg.action === 'toggleRecording') {
            if (!fab) {
                chrome.storage?.local?.get(['sttLang', 'splitFab'], (r) => {
                    currentLang = r?.sttLang || 'ar-IQ';
                    splitFab = !!r?.splitFab;
                    createFab();
                    startRecognition(currentLang);
                });
            } else if (isRecording) {
                stopRecognition();
            } else {
                startRecognition(currentLang);
            }
            sendResponse({ ok: true });
        } else if (msg.action === 'switchLang') {
            sendEngineCommand('switchLang');
            sendResponse({ ok: true });
        }
        return true;
    });

    /* ───── Keyboard Shortcuts (fallback) ───── */

    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (!fab) {
                chrome.storage?.local?.get(['sttLang'], (r) => {
                    currentLang = r?.sttLang || 'ar-IQ';
                    createFab();
                });
            } else if (isRecording) {
                stopRecognition();
            } else {
                startRecognition(currentLang);
            }
        }
        if (e.altKey && e.key.toLowerCase() === 'l') {
            e.preventDefault();
            sendEngineCommand('switchLang');
        }
        if (e.altKey && e.key.toLowerCase() === 'p') {
            e.preventDefault();
            pickerActive ? stopPicker() : startPicker();
        }
    });

    // Auto-show FAB by default on page load
    chrome.storage?.local?.get(['sttLang', 'splitFab'], (r) => {
        currentLang = r?.sttLang || 'ar-IQ';
        splitFab = !!r?.splitFab;
        createFab();
        updateFabLang();
    });

    console.log('[Vosk STT] Content script loaded');
})();
