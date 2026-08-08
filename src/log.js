/**
 * log.js — the running game log in the side panel.
 */

import { el } from './dom.js';

const MAX_LINES = 200;

function stamp() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function addLog(message, type = 'info') {
    if (!el.logMessages) return;

    const line = document.createElement('div');
    line.className = `log-line log-line--${type}`;

    const time = document.createElement('span');
    time.className = 'log-line__time';
    time.textContent = stamp();

    line.append(time, document.createTextNode(message));
    el.logMessages.appendChild(line);

    while (el.logMessages.children.length > MAX_LINES) el.logMessages.firstElementChild.remove();

    el.logMessages.scrollTop = el.logMessages.scrollHeight;

    if (!el.logPanel.classList.contains('is-open')) {
        el.logToggleBtn.classList.add('has-unread');
    }
}

export function clearLog() {
    if (el.logMessages) el.logMessages.innerHTML = '';
    el.logToggleBtn.classList.remove('has-unread');
}

export function toggleLog(force) {
    const open = force ?? !el.logPanel.classList.contains('is-open');
    el.logPanel.classList.toggle('is-open', open);
    if (open) el.logToggleBtn.classList.remove('has-unread');
    return open;
}
