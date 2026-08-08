/**
 * lobby.js — front of house, as three discrete steps:
 *
 *   menu  →  join  →  table          (client)
 *   menu  ─────────→  table          (host)
 *
 * Each step fully replaces the last, so nothing from an earlier step (the name
 * field especially) lingers on screen. Back is handled by the global top bar.
 */

import { el, $$ } from './dom.js';
import {
    ROOM_CODE_LENGTH, NAME_MIN, NAME_MAX, MIN_PLAYERS, MAX_PLAYERS, TURN_TIMER_OPTIONS,
    PLAYER_COLORS,
} from './constants.js';
import { gameState, localPlayer, session, initialsFor } from './state.js';
import { hostRoom, joinRoom, isConnected } from './net.js';
import { startNewGame } from './game.js';
import { showGameBoard } from './ui.js';
import { setTopbar } from './topbar.js';
import { icon } from './icons.js';
import { toast } from './toast.js';
import { sfx } from './audio.js';
import { addLog } from './log.js';

const NAME_KEY = 'emb.name';

/** Which lobby step is on screen. One of 'menu' | 'join' | 'table'. */
let step = 'menu';

/* ------------------------------------------------------------------ */
/* steps                                                               */
/* ------------------------------------------------------------------ */

export function goToStep(next) {
    step = next;
    el.stepMenu.classList.toggle('is-active', next === 'menu');
    el.stepJoin.classList.toggle('is-active', next === 'join');
    el.stepTable.classList.toggle('is-active', next === 'table');

    // each step titles itself in its own heading, so the floating controls
    // stay just controls
    if (next === 'menu') {
        setTopbar({ back: false });
        el.nameInput.focus();
    } else if (next === 'join') {
        setTopbar({ back: true });
        el.roomCodeInput.focus();
    } else {
        setTopbar({ back: true, roomCode: session.roomCode });
        renderWaitroom();
    }
}

export const currentStep = () => step;

/* ------------------------------------------------------------------ */
/* marquee                                                             */
/* ------------------------------------------------------------------ */

function buildBulbs() {
    const svg = el.marqueeBulbs;
    if (!svg) return;
    const NS = 'http://www.w3.org/2000/svg';
    const count = 22;
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
/* the waiting room                                                    */
/* ------------------------------------------------------------------ */

/** Seat positions around the preview table, clockwise from the far side. */
const WAIT_SLOTS = [
    { x: 50, y: -4 },
    { x: 108, y: 50 },
    { x: 50, y: 104 },
    { x: -8, y: 50 },
];

function occupantSeat(player, index) {
    const seat = document.createElement('div');
    seat.className = 'wseat is-taken';
    seat.style.setProperty('--seat-color', PLAYER_COLORS[index % PLAYER_COLORS.length]);

    const avatar = document.createElement('div');
    avatar.className = 'seat__avatar';
    avatar.style.setProperty('--seat-color', PLAYER_COLORS[index % PLAYER_COLORS.length]);
    avatar.textContent = initialsFor(player.name);
    if (player.isHost) avatar.appendChild(icon('star', 'ico--fill seat__host-mark'));

    const meta = document.createElement('div');
    meta.className = 'wseat__meta';

    const name = document.createElement('div');
    name.className = 'wseat__name';
    name.textContent = player.name;

    const tag = document.createElement('div');
    tag.className = 'wseat__tag';
    tag.textContent = player.id === localPlayer.id ? 'You' : (player.isHost ? 'Host' : 'Ready');

    meta.append(name, tag);
    seat.append(avatar, meta);
    return seat;
}

function emptySeat() {
    const seat = document.createElement('div');
    seat.className = 'wseat is-empty';
    seat.innerHTML = '<span class="wseat__waiting">Empty seat</span>';
    return seat;
}

export function renderWaitroom() {
    if (!el.waitroomSeats) return;

    const seated = localPlayer.isHost
        ? gameState.players.filter((p) => p.isHost || session.hostConnections[p.id])
        : gameState.players;

    el.waitroomSeats.innerHTML = '';
    for (let i = 0; i < MAX_PLAYERS; i++) {
        const player = seated[i];
        const node = player ? occupantSeat(player, i) : emptySeat();
        const slot = WAIT_SLOTS[i];
        node.style.left = `${slot.x}%`;
        node.style.top = `${slot.y}%`;
        node.style.setProperty('--wseat-delay', `${i * 70}ms`);
        el.waitroomSeats.appendChild(node);
    }

    el.playersCount.textContent = `${seated.length} / ${MAX_PLAYERS}`;
    el.turnTimerRow.hidden = !localPlayer.isHost;
    el.startGameBtn.hidden = !localPlayer.isHost;

    if (localPlayer.isHost) {
        const canStart = seated.length >= MIN_PLAYERS;
        el.waitroomTitle.textContent = 'Your table';
        el.waitroomSub.textContent = 'Share the code on the felt to fill the seats.';
        el.startGameBtn.disabled = !canStart;
        el.startHint.textContent = canStart
            ? `Ready to deal ${seated.length} in.`
            : 'Waiting for at least one more player…';
    } else {
        el.waitroomTitle.textContent = 'Waiting on the host';
        el.waitroomSub.textContent = 'The game starts when the host deals.';
        el.startHint.textContent = 'Sit tight.';
    }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += chars[Math.floor(Math.random() * chars.length)];
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
    });
    el.nameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') el.createRoomBtn.click();
    });

    el.createRoomBtn.addEventListener('click', () => {
        if (!takeName() || !requireConnection()) return;
        const code = generateRoomCode();
        el.roomCodeDisplay.textContent = code;
        hostRoom(code);
        goToStep('table');
        sfx.tap();
    });

    el.joinRoomBtn.addEventListener('click', () => {
        if (!takeName()) return;
        goToStep('join');
        sfx.tap();
    });

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
        if (!requireConnection()) return;

        const code = el.roomCodeInput.value.trim().toUpperCase();
        if (code.length !== ROOM_CODE_LENGTH) {
            toast(`Room codes are ${ROOM_CODE_LENGTH} characters.`, { type: 'error' });
            el.roomCodeInput.focus();
            return;
        }

        el.clientStatus.textContent = `Knocking on ${code}…`;
        el.clientStatus.dataset.tone = 'busy';
        el.connectBtn.disabled = true;
        el.roomCodeDisplay.textContent = code;
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
}

/** Reset the lobby back to the front door. */
export function resetLobby() {
    el.roomCodeDisplay.textContent = '•••••';
    el.roomCodeInput.value = '';
    el.roomCodeInput.disabled = false;
    el.connectBtn.disabled = false;
    el.clientStatus.textContent = "Enter the host's room code to join.";
    el.clientStatus.removeAttribute('data-tone');
    el.startGameBtn.disabled = true;
    el.waitroomSeats.innerHTML = '';
    goToStep('menu');
}
