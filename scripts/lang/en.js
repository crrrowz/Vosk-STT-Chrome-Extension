// English language module for Vosk STT
(() => {
    'use strict';

    window.__voskLangModules = window.__voskLangModules || {};

    window.__voskLangModules['en'] = {
        match: (langCode) => langCode.startsWith('en'),

        normalize: (text) => text, // English doesn't need normalization

        postProcess: (text) => text, // No number conversion for English

        voiceCommands: {
            'new line': '\n', 'next line': '\n', 'enter': '\n',
            'comma': ',',
            'period': '.', 'full stop': '.', 'dot': '.',
            'question mark': '?',
            'exclamation mark': '!', 'exclamation point': '!',
            'colon': ':',
            'semicolon': ';',
            'open parenthesis': '(', 'close parenthesis': ')',
            'open bracket': '[', 'close bracket': ']',
            'quote': '"', 'double quote': '"',
            'single quote': "'",
            'dash': '-', 'hyphen': '-',
            'underscore': '_',
            'hashtag': '#', 'hash': '#',
            'at sign': '@',
            'space': ' ',
            'clear all': '__CMD:clear',
            'undo': '__CMD:undo', 'undo that': '__CMD:undo',
            'delete': '__CMD:delete', 'delete that': '__CMD:delete',
            'select all': '__CMD:selectAll',
        },
    };
})();
