/**
 * topbar.js — the controls that float above every screen.
 *
 * Sound and the rules are reachable everywhere; back/leave and the log appear
 * only where they mean something. Nothing here knows about game rules —
 * `onBack` is supplied by main.js, which decides what "back" means right now.
 */

import { el } from './dom.js';

let backHandler = () => { };

/**
 * @param {object} opts
 * @param {boolean} [opts.back]      show the back/leave button
 * @param {string}  [opts.backLabel] tooltip for it
 * @param {string}  [opts.roomCode]  room code chip, omitted when falsy
 * @param {boolean} [opts.inGame]    reveals the log button and the turn pill
 */
export function setTopbar({ back = false, backLabel = 'Back', roomCode = null, inGame = false } = {}) {
    el.backBtn.hidden = !back;
    el.backBtn.title = backLabel;
    el.backBtn.setAttribute('aria-label', backLabel);

    el.hudRoomCode.hidden = !roomCode;
    if (roomCode) el.hudRoomCode.textContent = roomCode;

    el.logToggleBtn.hidden = !inGame;
    el.turnPill.hidden = !inGame;
}

export function onBack(fn) {
    backHandler = fn;
}

export function initTopbar() {
    el.backBtn.addEventListener('click', () => backHandler());
}
