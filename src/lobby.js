/**
 * lobby.js — the front-of-house: name entry, hosting, joining, table options.
 */

import { el, $$ } from './dom.js';
import {
    ROOM_CODE_LENGTH, NAME_MIN, NAME_MAX, MIN_PLAYERS, TURN_TIMER_OPTIONS,
} from './constants.js';
import { gameState, localPlayer, session } from './state.js';
import { hostRoom, joinRoom, isConnected, sendMessage } from './net.js';
import { startNewGame } from './game.js';
import { showGameBoard, updateLobbySeats } from './ui.js';
import { toast } from './toast.js';
import { sfx } from './audio.js';
import { addLog } from './log.js';

const NAME_KEY = 'emb.name';

/* ------------------------------------------------------------------ */
/* marquee                                                             */
/* ------------------------------------------------------------------ */

function buildBulbs() {
    const svg = el.marqueeBulbs;
    if (!svg) return;
    const count = 22;
    const NS = 'http://www.w3.org/2000/svg';
    for (let i = 0; i < count; i++) {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('cx', String((i + 0.5) * (400 / count)));
        c.setAttribute('cy', '6');
        c.setAttribute('r', '2.6');
        c.setAttribute('style', `animation-delay:${(i % 5) * 0.22}s`);
        svg.appendChild(c);
    }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
}

function showHint(message) {
    el.nameHint.textContent = message;
    el.nameHint.classList.toggle('is-shown', !!message);
}

/** @returns {string|null} the trimmed name, or null if it isn't usable. */
function takeName() {
    const name = el.nameInput.value.trim().slice(0, NAME_MAX);
    if (name.length < NAME_MIN) {
        showHint(`Needs at least ${NAME_MIN} characters.`);
        el.nameInput.focus();
        sfx.error();
        return null;
    }
    showHint('');
    localPlayer.name = name;
    localStorage.setItem(NAME_KEY, name);
    return name;
}

function requireConnection() {
    if (isConnected()) return true;
    toast('Still waking the server — give it a moment.', { type: 'warn' });
    return false;
}

function showChoice() {
    el.lobbyChoice.hidden = false;
    el.hostControls.hidden = true;
    el.clientControls.hidden = true;
}

async function copyRoomCode() {
    const code = el.roomCodeDisplay.textContent;
    if (!code || code.startsWith('•')) return;
    try {
        await navigator.clipboard.writeText(code);
        el.copyRoomCodeBtn.textContent = 'Copied';
        el.copyRoomCodeBtn.disabled = true;
        setTimeout(() => {
            el.copyRoomCodeBtn.textContent = 'Copy';
            el.copyRoomCodeBtn.disabled = false;
        }, 1500);
        sfx.tap();
    } catch {
        toast('Copy failed — select the code manually.', { type: 'error' });
    }
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

export function initLobby() {
    buildBulbs();

    const saved = localStorage.getItem(NAME_KEY);
    if (saved) el.nameInput.value = saved;

    el.nameInput.addEventListener('input', () => {
        if (el.nameInput.value.trim().length >= NAME_MIN) showHint('');
        // let a joined client rename themselves on the fly
        if (session.roomCode && !localPlayer.isHost && el.nameInput.value.trim().length >= NAME_MIN) {
            localPlayer.name = el.nameInput.value.trim();
            sendMessage('CLIENT_NAME_UPDATE', { name: localPlayer.name });
        }
    });

    el.createRoomBtn.addEventListener('click', () => {
        if (!takeName() || !requireConnection()) return;
        el.lobbyChoice.hidden = true;
        el.clientControls.hidden = true;
        el.hostControls.hidden = false;

        const code = generateRoomCode();
        el.roomCodeDisplay.textContent = code;
        el.roomCodeDisplay.classList.remove('is-waiting');
        hostRoom(code);
        sfx.tap();
    });

    el.joinRoomBtn.addEventListener('click', () => {
        if (!takeName()) return;
        el.lobbyChoice.hidden = true;
        el.hostControls.hidden = true;
        el.clientControls.hidden = false;
        el.roomCodeInput.focus();
        sfx.tap();
    });

    $$('[data-back-to-choice]').forEach((btn) =>
        btn.addEventListener('click', () => {
            showChoice();
            sfx.tap();
        }),
    );

    el.copyRoomCodeBtn.addEventListener('click', copyRoomCode);

    // --- turn timer option (host) ---
    el.turnTimerSeg.addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-sec]');
        if (!btn) return;
        const seconds = Number(btn.dataset.sec);
        if (!TURN_TIMER_OPTIONS.includes(seconds)) return;

        $$('button', el.turnTimerSeg).forEach((b) => b.classList.toggle('is-active', b === btn));
        gameState.config.turnSeconds = seconds;
        sfx.tap();
    });

    // --- joining ---
    el.roomCodeInput.addEventListener('input', () => {
        el.roomCodeInput.value = el.roomCodeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    });
    el.roomCodeInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') el.connectBtn.click();
    });

    el.connectBtn.addEventListener('click', () => {
        if (!takeName() || !requireConnection()) return;

        const code = el.roomCodeInput.value.trim().toUpperCase();
        if (code.length !== ROOM_CODE_LENGTH) {
            toast(`Room codes are ${ROOM_CODE_LENGTH} characters.`, { type: 'error' });
            el.roomCodeInput.focus();
            return;
        }

        el.clientStatus.textContent = `Knocking on ${code}…`;
        el.clientStatus.dataset.tone = 'busy';
        el.connectBtn.disabled = true;
        joinRoom(code);
        sfx.tap();

        setTimeout(() => {
            if (el.clientStatus.dataset.tone === 'busy') {
                el.clientStatus.textContent = 'No answer. Check the code and try again.';
                el.clientStatus.dataset.tone = 'bad';
                el.connectBtn.disabled = false;
            }
        }, 8000);
    });

    // --- starting ---
    el.startGameBtn.addEventListener('click', () => {
        if (!localPlayer.isHost) return;
        const seated = Object.keys(session.hostConnections).length + 1;
        if (seated < MIN_PLAYERS) {
            toast(`Need at least ${MIN_PLAYERS} players.`, { type: 'warn' });
            return;
        }
        addLog('Game starting.', 'success');
        startNewGame();
        showGameBoard();
    });

    updateLobbySeats();
}
