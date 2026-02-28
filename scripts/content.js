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
    let positionRafId = null; // ISSUE-17: rAF debounce for positionOverlay
    let cachedInput = null;   // ISSUE-15: cached resolveTargetInput
    let cachedInputTime = 0;  // ISSUE-15: cache timestamp

    const LANG_LABELS = {
        'ar-IQ': 'عربي', 'ar-SA': 'عربي', 'ar': 'عربي', 'en-US': 'EN'
    };
    const LANG_SHORT = {
        'ar-IQ': 'AR', 'ar-SA': 'AR', 'ar': 'AR', 'en-US': 'EN'
    };

    /* ───── Utility: Extension Context Guard (ISSUE-04) ───── */

    function isExtensionAlive() {
        return !!chrome.runtime?.id;
    }

    /* ───── Utility: Text Sanitization (ISSUE-03) ───── */

    function sanitizeText(text) {
        if (!text) return '';
        // Strip HTML tags and non-printable control chars (keep \n)
        return text.replace(/<[^>]*>/g, '').replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }

    /* ───── Utility: Create SVG Mic Icon (ISSUE-01) ───── */

    function createMicSvg() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        const p1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p1.setAttribute('d', 'M12 1C10.34 1 9 2.34 9 4V12C9 13.66 10.34 15 12 15C13.66 15 15 13.66 15 12V4C15 2.34 13.66 1 12 1Z');
        const p2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p2.setAttribute('d', 'M17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12H5C5 15.53 7.61 18.43 11 18.93V22H13V18.93C16.39 18.43 19 15.53 19 12H17Z');
        svg.appendChild(p1);
        svg.appendChild(p2);
        return svg;
    }

    /* ───── Inject Speech Engine ───── */

    let engineInjected = false;
    function injectSpeechEngine() {
        if (engineInjected) return;
        engineInjected = true;
        const old = document.getElementById('vosk-stt-engine');
        if (old) old.remove();
        const script = document.createElement('script');
        script.id = 'vosk-stt-engine';
        script.src = chrome.runtime.getURL('scripts/speech-engine.js');
        (document.head || document.documentElement).appendChild(script);
    }

    injectSpeechEngine();

    function sendEngineCommand(command, lang) {
        if (!isExtensionAlive()) return; // ISSUE-04
        document.dispatchEvent(new CustomEvent('vosk-stt-command', {
            detail: { command, lang }
        }));
    }

    /* ───── FAB (Floating Action Button) ───── */

    function createFab() {
        if (fab) return;

        fab = document.createElement('button');
        fab.id = 'vosk-fab';
        fab.setAttribute('aria-label', 'Toggle voice recording'); // ROAD-08
        renderFabContent();

        // Load saved position or default
        if (isExtensionAlive()) {
            chrome.storage?.local?.get(['fabPosition'], (r) => {
                if (chrome.runtime.lastError) return; // ISSUE-08
                const pos = r?.fabPosition;
                if (fab) {
                    fab.style.bottom = pos?.bottom || '24px';
                    fab.style.right = pos?.right || '24px';
                }
            });
        }

        document.body.appendChild(fab);
        makeDraggable(fab);

        fab.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (isRecording) {
                stopRecognition();
            } else {
                if (!isExtensionAlive()) {
                    console.warn('[Vosk STT] Extension context invalidated. Please refresh.');
                    removeFab();
                    return;
                }
                chrome.storage?.local?.get(['sttLang'], (r) => {
                    if (chrome.runtime.lastError) return; // ISSUE-08
                    currentLang = r?.sttLang || 'ar-IQ';
                    updateFabLang();
                    startRecognition(currentLang);
                });
            }
        });
    }

    // ISSUE-01: Replace innerHTML with DOM API
    function renderFabContent() {
        if (!fab) return;

        // Clear existing children
        while (fab.firstChild) fab.removeChild(fab.firstChild);

        if (splitFab) {
            fab.classList.add('split');

            fab.appendChild(createMicSvg());

            const langBadge = document.createElement('div');
            langBadge.id = 'vosk-fab-lang';
            langBadge.textContent = LANG_SHORT[currentLang] || 'AR';
            fab.appendChild(langBadge);

            const halfEn = document.createElement('div');
            halfEn.className = 'vosk-fab-half' + (currentLang === 'en-US' ? ' active-lang' : '');
            halfEn.dataset.lang = 'en-US';
            halfEn.textContent = 'EN';
            halfEn.addEventListener('click', onHalfClick);
            fab.appendChild(halfEn);

            const halfAr = document.createElement('div');
            halfAr.className = 'vosk-fab-half' + (currentLang.startsWith('ar') ? ' active-lang' : '');
            halfAr.dataset.lang = 'ar-IQ';
            halfAr.textContent = 'AR';
            halfAr.addEventListener('click', onHalfClick);
            fab.appendChild(halfAr);
        } else {
            fab.classList.remove('split');

            fab.appendChild(createMicSvg());

            const langBadge = document.createElement('div');
            langBadge.id = 'vosk-fab-lang';
            langBadge.textContent = LANG_SHORT[currentLang] || 'AR';
            fab.appendChild(langBadge);
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
            if (isExtensionAlive()) chrome.storage?.local?.set({ sttLang: lang });
        } catch (_err) { console.warn('[Vosk STT] storage set failed', _err); } // ISSUE-08, ISSUE-10

        updateSplitActive();

        if (isRecording) {
            pendingLangStart = lang;
            stopRecognition();
        } else {
            if (!isExtensionAlive()) {
                console.warn('[Vosk STT] Extension context invalidated. Please refresh.');
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

            if (hasMoved) {
                el.addEventListener('click', blockClick, { once: true, capture: true });
                try {
                    chrome.storage?.local?.set({ fabPosition: { bottom: el.style.bottom, right: el.style.right } });
                } catch (_err) { console.warn('[Vosk STT] fab position save failed', _err); } // ISSUE-08, ISSUE-10
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
            cachedInput = null; // ISSUE-15: invalidate cache on focus change
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
                updateOverlayText('', data.interim || '🎤 Speak now...');
                setSpeaking(!!data.interim);

                if (data.final && data.final.trim()) {
                    const textToInsert = sanitizeText(data.final.trim()); // ISSUE-03
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
                if (!isRecording && !pendingLangStart) break;
                isRecording = false;
                updateFabState();
                hideOverlay();
                try { chrome.runtime.sendMessage({ action: 'stopped' }); } catch (_err) { /* tab may be closing */ }
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

    // ISSUE-23: Check pickerActive before stopping
    function onPickerEscape(e) {
        if (!pickerActive) return;
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            stopPicker();
        }
    }

    /* ───── Overlay (ISSUE-01: DOM API, ROAD-08: aria) ───── */

    function createOverlay() {
        if (overlay) return overlay;
        overlay = document.createElement('div');
        overlay.id = 'vosk-stt-overlay';
        overlay.setAttribute('role', 'status');       // ROAD-08
        overlay.setAttribute('aria-live', 'polite');   // ROAD-08

        const card = document.createElement('div');
        card.className = 'vosk-stt-card';

        const header = document.createElement('div');
        header.className = 'vosk-stt-header';

        const dot = document.createElement('div');
        dot.className = 'vosk-stt-dot';
        header.appendChild(dot);

        const label = document.createElement('span');
        label.className = 'vosk-stt-label';
        label.textContent = 'Listening...';
        header.appendChild(label);

        const waves = document.createElement('div');
        waves.className = 'vosk-stt-waves';
        for (let i = 0; i < 5; i++) {
            const w = document.createElement('div');
            w.className = 'vosk-stt-wave';
            waves.appendChild(w);
        }
        header.appendChild(waves);
        card.appendChild(header);

        const textEl = document.createElement('div');
        textEl.className = 'vosk-stt-text';
        const partial = document.createElement('span');
        partial.className = 'partial';
        partial.textContent = '🎤 Speak now...';
        textEl.appendChild(partial);
        card.appendChild(textEl);

        overlay.appendChild(card);
        document.body.appendChild(overlay);
        return overlay;
    }

    function positionOverlay() {
        if (!overlay) return;
        if (fab) {
            const fabRect = fab.getBoundingClientRect();
            const oh = overlay.offsetHeight || 80;
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

    // ISSUE-17: rAF-debounced position update
    function schedulePositionOverlay() {
        if (positionRafId) cancelAnimationFrame(positionRafId);
        positionRafId = requestAnimationFrame(() => {
            positionOverlay();
            positionRafId = null;
        });
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

    // ISSUE-21: Capture overlay ref in closure to prevent stale removal
    function hideOverlay() {
        if (!overlay) return;
        const overlayRef = overlay;
        overlayRef.classList.remove('visible');
        overlayRef.classList.add('fade-out');
        hideTimeout = setTimeout(() => {
            overlayRef.remove();
            // Only null the global if it's still the same element
            if (overlay === overlayRef) overlay = null;
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
        schedulePositionOverlay(); // ISSUE-17: debounced
    }

    /* ───── Input Resolution & Text Insertion ───── */

    // ISSUE-15: Cached resolveTargetInput with 2s TTL
    function resolveTargetInput() {
        if (cachedInput && document.body.contains(cachedInput) && (Date.now() - cachedInputTime < 2000)) {
            return cachedInput;
        }
        let result = null;
        if (targetInput && document.body.contains(targetInput)) {
            result = targetInput;
        } else if (lastFocusedInput && document.body.contains(lastFocusedInput)) {
            result = lastFocusedInput;
        } else {
            const el = document.activeElement;
            if (el && isInputElement(el)) {
                result = el;
            } else {
                const inputs = document.querySelectorAll('input[type="text"],input[type="search"],input:not([type]),textarea,[contenteditable="true"],[role="textbox"]');
                for (const inp of inputs) {
                    const r = inp.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight) {
                        result = inp;
                        break;
                    }
                }
            }
        }
        cachedInput = result;
        cachedInputTime = Date.now();
        return result;
    }

    function insertText(el, text) {
        if (!el || !text) return;
        text = sanitizeText(text); // ISSUE-03
        el.focus();
        if (el.isContentEditable || el.getAttribute?.('role') === 'textbox') {
            const sel = window.getSelection();
            const range = document.createRange();

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
                range.collapse(false);
            }
            sel.removeAllRanges();
            sel.addRange(range);

            const existing = el.textContent || '';
            const sep = existing && !existing.endsWith(' ') ? ' ' : '';
            if (!document.execCommand('insertText', false, sep + text)) {
                el.appendChild(document.createTextNode(sep + text));
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }
        } else {
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
        if (!isExtensionAlive()) { // ISSUE-04
            removeFab();
            return;
        }
        targetInput = resolveTargetInput();
        isRecording = true;
        updateFabState();
        showOverlay();
        try {
            chrome.runtime.sendMessage({ action: 'startRecordingFromTab', tabId: 'self' });
        } catch (_err) { console.warn('[Vosk STT] startRecordingFromTab failed', _err); } // ISSUE-08, ISSUE-10
        setTimeout(() => sendEngineCommand('start', lang), 100);
    }

    function stopRecognition() {
        sendEngineCommand('stop');
    }

    /* ───── Chrome Message Listener (ISSUE-14: proper async sendResponse) ───── */

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
                if (!isExtensionAlive()) { sendResponse({ ok: false }); return true; }
                chrome.storage?.local?.get(['sttLang', 'splitFab'], (r) => {
                    if (chrome.runtime.lastError) { sendResponse({ ok: false }); return; }
                    currentLang = r?.sttLang || 'ar-IQ';
                    splitFab = !!r?.splitFab;
                    createFab();
                    updateFabLang();
                    sendResponse({ ok: true });
                });
            }
            return true; // ISSUE-14: keep channel open for async
        }

        if (msg.action === 'setLang') {
            currentLang = msg.lang || 'ar-IQ';
            updateFabLang();
            updateSplitActive();
            sendResponse({ ok: true });
            return true;
        }

        if (msg.action === 'setSplit') {
            splitFab = !!msg.split;
            if (fab) renderFabContent();
            sendResponse({ ok: true });
            return true;
        }

        if (msg.action === 'pickInput') {
            startPicker();
            sendResponse({ ok: true });
            return true;
        }

        if (msg.action === 'start') {
            currentLang = msg.lang || 'ar-IQ';
            createFab();
            startRecognition(currentLang);
            sendResponse({ ok: true });
            return true;
        }

        // ISSUE-22: Show toast when stopped by another tab
        if (msg.action === 'stop') {
            if (isRecording) {
                updateOverlayText('', '🔄 Recording moved to another tab');
                setTimeout(() => {
                    stopRecognition();
                }, 1200);
            } else {
                stopRecognition();
            }
            sendResponse({ ok: true });
            return true;
        }

        if (msg.action === 'toggleRecording') {
            if (!fab) {
                if (!isExtensionAlive()) { sendResponse({ ok: false }); return true; }
                chrome.storage?.local?.get(['sttLang', 'splitFab'], (r) => {
                    if (chrome.runtime.lastError) { sendResponse({ ok: false }); return; }
                    currentLang = r?.sttLang || 'ar-IQ';
                    splitFab = !!r?.splitFab;
                    createFab();
                    startRecognition(currentLang);
                    sendResponse({ ok: true });
                });
            } else if (isRecording) {
                stopRecognition();
                sendResponse({ ok: true });
            } else {
                startRecognition(currentLang);
                sendResponse({ ok: true });
            }
            return true; // ISSUE-14
        }

        if (msg.action === 'switchLang') {
            sendEngineCommand('switchLang');
            sendResponse({ ok: true });
            return true;
        }

        return true;
    });

    /* ───── Keyboard Shortcuts (fallback) ───── */

    document.addEventListener('keydown', (e) => {
        if (e.altKey && e.key.toLowerCase() === 's') {
            e.preventDefault();
            if (!fab) {
                if (!isExtensionAlive()) return;
                chrome.storage?.local?.get(['sttLang'], (r) => {
                    if (chrome.runtime.lastError) return;
                    currentLang = r?.sttLang || 'ar-IQ';
                    createFab();
                    startRecognition(currentLang); // ISSUE-20: also start recording
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

    // ISSUE-18 + ROAD-01: Auto-show FAB based on user preference
    if (isExtensionAlive()) {
        chrome.storage?.local?.get(['sttLang', 'splitFab', 'fabAutoShow'], (r) => {
            if (chrome.runtime.lastError) return;
            // Default to true if preference not set
            if (r?.fabAutoShow === false) return;
            currentLang = r?.sttLang || 'ar-IQ';
            splitFab = !!r?.splitFab;
            createFab();
            updateFabLang();
        });

        // Live-react to fabAutoShow toggle
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !changes.fabAutoShow) return;
            if (changes.fabAutoShow.newValue === false) {
                if (isRecording) stopRecognition();
                removeFab();
            } else if (changes.fabAutoShow.newValue === true && !fab) {
                chrome.storage?.local?.get(['sttLang', 'splitFab'], (r) => {
                    if (chrome.runtime.lastError) return;
                    currentLang = r?.sttLang || 'ar-IQ';
                    splitFab = !!r?.splitFab;
                    createFab();
                    updateFabLang();
                });
            }
        });
    }
})();
