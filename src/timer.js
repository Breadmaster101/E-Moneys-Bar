/**
 * timer.js — the turn clock.
 *
 * Two halves that never talk to each other:
 *   • the visual countdown every client draws in the HUD
 *   • the host-side enforcement timer that acts for an idle player
 */

import { el } from './dom.js';
import { gameState, isMyTurn } from './state.js';
import { sfx } from './audio.js';

// perimeter of the square timer path in index.html: 4 × 34
const ARC_LENGTH = 136;

/* ------------------------------------------------------------------ */
/* visual countdown (everyone)                                         */
/* ------------------------------------------------------------------ */

/*
 * Driven by setInterval rather than requestAnimationFrame on purpose: rAF is
 * suspended while the tab is backgrounded, and a countdown that silently stops
 * when you alt-tab is worse than one that ticks 10x a second.
 */
const TICK_MS = 100;

let ticker = null;
let endsAt = 0;
let totalMs = 0;
let lastTickSecond = -1;
let shownEpoch = null;

function paint() {
    const remaining = Math.max(0, endsAt - performance.now());
    const ratio = totalMs > 0 ? remaining / totalMs : 0;
    const low = remaining <= 5000;

    el.turnTimerArc.style.strokeDashoffset = String(ARC_LENGTH * (1 - ratio));
    el.turnTimerArc.classList.toggle('is-low', low);
    el.turnPill.classList.toggle('is-urgent', low && remaining > 0);

    const second = Math.ceil(remaining / 1000);
    if (low && second !== lastTickSecond && second > 0 && isMyTurn()) {
        lastTickSecond = second;
        sfx.tick(second <= 3);
    }

    if (remaining <= 0) {
        clearInterval(ticker);
        ticker = null;
        el.turnPill.classList.remove('is-urgent');
    }
}

export function stopCountdown() {
    clearInterval(ticker);
    ticker = null;
    shownEpoch = null;
    lastTickSecond = -1;
    el.turnTimerArc.style.strokeDashoffset = String(ARC_LENGTH);
    el.turnTimerArc.classList.remove('is-low');
    el.turnPill.classList.remove('is-urgent');
}

/**
 * Sync the on-screen countdown with the state we just received.
 * Restarts only when the host says the turn actually changed.
 */
export function syncCountdown() {
    const seconds = gameState.config?.turnSeconds ?? 0;
    const playing = gameState.gamePhase === 'playing' && gameState.currentPlayerId;

    if (!seconds || !playing) {
        stopCountdown();
        return;
    }

    const epoch = gameState.turnEpoch ?? 0;
    if (epoch === shownEpoch) return;

    shownEpoch = epoch;
    lastTickSecond = -1;
    totalMs = seconds * 1000;
    endsAt = performance.now() + (gameState.turnRemainingMs || totalMs);

    clearInterval(ticker);
    ticker = setInterval(paint, TICK_MS);
    paint();
}

/* ------------------------------------------------------------------ */
/* enforcement (host only)                                             */
/* ------------------------------------------------------------------ */

let hostTimeout = null;
let hostDeadline = 0;

export function armHostTimer(seconds, onExpire) {
    disarmHostTimer();
    if (!seconds) return;
    hostDeadline = Date.now() + seconds * 1000;
    hostTimeout = setTimeout(onExpire, seconds * 1000);
}

export function disarmHostTimer() {
    clearTimeout(hostTimeout);
    hostTimeout = null;
    hostDeadline = 0;
}

/** ms left on the host's clock, for broadcasting to clients. */
export function hostRemainingMs() {
    return hostDeadline ? Math.max(0, hostDeadline - Date.now()) : 0;
}
