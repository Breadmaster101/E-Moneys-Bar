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
 * How far our reading may drift from the host's before we take theirs.
 *
 * There has to be some tolerance or every state update would restart the
 * countdown on network jitter alone, and there has to be some correction or a
 * phone that was asleep for a minute comes back showing a clock that expired
 * while the turn is still live. A second and a half is wider than the wire and
 * narrower than anything a player would notice.
 */
const DRIFT_TOLERANCE_MS = 1500;

/**
 * Sync the on-screen countdown with the state we just received.
 *
 * Restarts when the host says the turn changed, and *re-seats* when our reading
 * has drifted away from the host's. The second case is the one that matters on
 * a phone: a backgrounded tab has no timers, so on the way back `endsAt` is
 * measured from a `performance.now()` that has moved on without us and the arc
 * reads empty on a turn with twenty seconds left on it. The host's number is
 * the real one; this is where we take it.
 */
export function syncCountdown() {
    const seconds = gameState.config?.turnSeconds ?? 0;
    const playing = gameState.gamePhase === 'playing' && gameState.currentPlayerId;

    if (!seconds || !playing) {
        stopCountdown();
        return;
    }

    const epoch = gameState.turnEpoch ?? 0;
    const hostRemaining = gameState.turnRemainingMs;
    const newTurn = epoch !== shownEpoch;

    if (!newTurn) {
        if (hostRemaining === undefined) return;
        const ours = Math.max(0, endsAt - performance.now());
        if (Math.abs(ours - hostRemaining) < DRIFT_TOLERANCE_MS) return;
    }

    shownEpoch = epoch;
    if (newTurn) nextBeatAt = PULSE_MS;
    totalMs = seconds * 1000;
    endsAt = performance.now() + (hostRemaining || totalMs);

    clearInterval(ticker);
    ticker = setInterval(paint, TICK_MS);
    paint();
}

/* ------------------------------------------------------------------ */
/* enforcement (host only)                                             */
/* ------------------------------------------------------------------ */

/*
 * A watchdog rather than a single `setTimeout`, because the host is as likely
 * to be a phone as anyone else and a backgrounded tab does not run timers. One
 * long timeout there does not fire late, it fires *wrong*: on the way back it
 * either goes off immediately, having "expired" during a freeze in which nobody
 * could have played anyway, or sits waiting out a delay the browser has already
 * decided to stretch.
 *
 * Checking a deadline on a short tick makes both cases the same case, and lets
 * the gap between ticks be measured. A gap much longer than the tick means the
 * page was frozen — and if the *host* was frozen then so was the whole table,
 * since every play goes through here, so the deadline moves forward by however
 * long it lost rather than being spent on a turn nobody could take.
 */
const WATCHDOG_MS = 500;

/** A gap wider than this between ticks was a freeze, not scheduling jitter. */
const FREEZE_GAP_MS = 2000;

let watchdog = null;
let lastWatchAt = 0;
let hostDeadline = 0;
let hostExpire = null;

export function armHostTimer(seconds, onExpire) {
    disarmHostTimer();
    if (!seconds) return;

    hostDeadline = Date.now() + seconds * 1000;
    hostExpire = onExpire;
    lastWatchAt = Date.now();
    watchdog = setInterval(() => {
        const now = Date.now();
        const gap = now - lastWatchAt;
        lastWatchAt = now;

        if (gap > FREEZE_GAP_MS) {
            hostDeadline += gap;
            return;
        }
        if (now < hostDeadline) return;

        const expire = hostExpire;
        disarmHostTimer();
        expire?.();
    }, WATCHDOG_MS);
}

export function disarmHostTimer() {
    clearInterval(watchdog);
    watchdog = null;
    hostDeadline = 0;
    hostExpire = null;
}

/* ------------------------------------------------------------------ */
/* host-side scheduling (host only)                                    */
/* ------------------------------------------------------------------ */

/*
 * The other thing the host does on a delay: hand off to whatever comes after
 * the roulette, once the animation everybody is watching has finished.
 *
 * That was a bare `setTimeout`, and it was the worst freeze in the game to be
 * caught by. The roulette is exactly when a phone gets put down — the shot is
 * on screen, nobody is touching anything — and a host whose page suspends
 * there never deals the next round. The turn timer is disarmed for the
 * duration, so nothing else is left running to notice: the whole table sits in
 * `roulette_resolved` looking at a spent cylinder, with no path back.
 *
 * So the timeout keeps its exact timing for the normal case and a watchdog sits
 * behind it for the case where it does not fire. Unlike the turn clock there is
 * no credit for lost time: the sequence has a fixed length and if it has run
 * out while the page was away, the right move is to get on with it.
 */

let scheduleSeq = 0;
const scheduled = new Map();
let scheduleTicker = null;

function runDue(id) {
    const entry = scheduled.get(id);
    if (!entry) return;              // already fired, or cancelled
    scheduled.delete(id);
    clearTimeout(entry.timer);
    if (!scheduled.size) {
        clearInterval(scheduleTicker);
        scheduleTicker = null;
    }
    entry.fn();
}

/**
 * Run `fn` in `ms`, and run it even if this page is frozen when the timer was
 * due. Host-only; cancelled wholesale by `cancelHostDelays()`.
 */
export function afterHostDelay(ms, fn) {
    const id = ++scheduleSeq;
    scheduled.set(id, { at: Date.now() + ms, fn, timer: setTimeout(() => runDue(id), ms) });

    if (!scheduleTicker) {
        scheduleTicker = setInterval(() => {
            const now = Date.now();
            for (const [key, entry] of [...scheduled]) {
                if (now >= entry.at) runDue(key);
            }
        }, WATCHDOG_MS);
    }
    return id;
}

/** Drop everything pending: leaving the table, or starting a fresh game. */
export function cancelHostDelays() {
    scheduled.forEach((entry) => clearTimeout(entry.timer));
    scheduled.clear();
    clearInterval(scheduleTicker);
    scheduleTicker = null;
}

/** ms left on the host's clock, for broadcasting to clients. */
export function hostRemainingMs() {
    return hostDeadline ? Math.max(0, hostDeadline - Date.now()) : 0;
}
