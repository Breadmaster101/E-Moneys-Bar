/**
 * timer.js: the turn clock.
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

/** When the pill starts reading as urgent. */
const LOW_MS = 5000;

/*
 * The pulse starts earlier than the pill turns, because the two are doing
 * different jobs: the arc reports, and the heartbeat is meant to have been
 * under you for a couple of seconds before you notice it.
 */
const PULSE_MS = 8000;
const BEAT_SLOW_MS = 900;
const BEAT_FAST_MS = 470;

let ticker = null;
let endsAt = 0;
let totalMs = 0;
let shownEpoch = null;

/** Remaining-ms reading at which the next heartbeat is due. */
let nextBeatAt = 0;

function paint() {
    const remaining = Math.max(0, endsAt - performance.now());
    const ratio = totalMs > 0 ? remaining / totalMs : 0;
    const low = remaining <= LOW_MS;

    el.turnTimerArc.style.strokeDashoffset = String(ARC_LENGTH * (1 - ratio));
    el.turnTimerArc.classList.toggle('is-low', low);
    el.turnPill.classList.toggle('is-urgent', low && remaining > 0);

    /*
     * Scheduled against the clock rather than once a second, so the gap between
     * beats can close as the turn runs out. Only ever for the player on the
     * clock: a heartbeat is the one sound here that isn't coming from the
     * table, and hearing somebody else's would be nonsense.
     */
    if (isMyTurn() && remaining > 0 && remaining <= PULSE_MS && remaining <= nextBeatAt) {
        const p = 1 - remaining / PULSE_MS;
        sfx.heartbeat(p);
        nextBeatAt = remaining - (BEAT_SLOW_MS - p * (BEAT_SLOW_MS - BEAT_FAST_MS));
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
    nextBeatAt = PULSE_MS;
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
    nextBeatAt = PULSE_MS;
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
