/**
 * audio.js: every sound in the game is synthesised at runtime with WebAudio.
 * No asset files, no network, ~nothing to load.
 *
 * The AudioContext can only start after a user gesture, so `unlock()` is wired
 * to the first click/keypress in main.js.
 */

const STORAGE_KEY = 'emb.muted';

let ctx = null;
let master = null;
let noiseBuf = null;
let muted = localStorage.getItem(STORAGE_KEY) === '1';

const now = () => ctx.currentTime;

function ensureContext() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.85;
    master.connect(ctx.destination);

    // 2s of white noise, reused by every percussive sound
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return true;
}

export function unlock() {
    if (!ensureContext()) return;
    if (ctx.state === 'suspended') ctx.resume();
}

export function isMuted() {
    return muted;
}

export function setMuted(next) {
    muted = next;
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, now(), 0.02);
    return muted;
}

export function toggleMute() {
    unlock();
    return setMuted(!muted);
}

const ready = () => ctx && !muted && ctx.state === 'running';

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

/** A filtered burst of noise: clicks, whooshes, gunshots. */
function noise({ at = 0, dur = 0.1, type = 'bandpass', freq = 1200, q = 1, gain = 0.3, sweepTo = null }) {
    if (!ready()) return;
    const t = now() + at;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;

    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, t);
    filt.Q.value = q;
    if (sweepTo) filt.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.008, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(filt).connect(g).connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
}

/** A pitched tone with an optional glide. */
function tone({ at = 0, freq = 440, to = null, type = 'sine', dur = 0.2, gain = 0.2, attack = 0.005 }) {
    if (!ready()) return;
    const t = now() + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(g).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
}

/** Mechanical click: the revolver's whole personality. */
function mechClick(at = 0, strength = 1) {
    noise({ at, dur: 0.035 * strength, type: 'highpass', freq: 2600, gain: 0.22 * strength });
    tone({ at, freq: 190, to: 70, type: 'square', dur: 0.035, gain: 0.06 * strength });
}

/* ------------------------------------------------------------------ */
/* the sound board                                                     */
/* ------------------------------------------------------------------ */

export const sfx = {
    hover() {
        tone({ freq: 900, type: 'sine', dur: 0.04, gain: 0.03 });
    },

    tap() {
        noise({ dur: 0.04, type: 'highpass', freq: 2200, gain: 0.12 });
        tone({ freq: 520, to: 380, type: 'triangle', dur: 0.06, gain: 0.06 });
    },

    /** picking a card up out of the fan */
    cardSelect() {
        noise({ dur: 0.09, type: 'bandpass', freq: 1800, q: 0.8, gain: 0.16, sweepTo: 4200 });
        tone({ freq: 620, to: 880, type: 'triangle', dur: 0.09, gain: 0.05 });
    },

    cardDeselect() {
        noise({ dur: 0.08, type: 'bandpass', freq: 3600, q: 0.8, gain: 0.13, sweepTo: 1400 });
        tone({ freq: 700, to: 460, type: 'triangle', dur: 0.08, gain: 0.04 });
    },

    /** cards thrown onto the pile */
    cardPlay(count = 1) {
        for (let i = 0; i < count; i++) {
            const at = i * 0.075;
            noise({ at, dur: 0.14, type: 'bandpass', freq: 2400, q: 0.6, gain: 0.2, sweepTo: 700 });
            tone({ at: at + 0.05, freq: 150, to: 60, type: 'sine', dur: 0.12, gain: 0.11 });
        }
    },

    /** dealing a fresh hand */
    deal(count = 5) {
        for (let i = 0; i < count; i++) {
            noise({ at: i * 0.07, dur: 0.1, type: 'bandpass', freq: 2800, q: 0.7, gain: 0.15, sweepTo: 900 });
        }
    },

    /** somebody calls it */
    liar() {
        tone({ freq: 320, to: 150, type: 'sawtooth', dur: 0.6, gain: 0.11 });
        tone({ at: 0.02, freq: 214, to: 100, type: 'sawtooth', dur: 0.65, gain: 0.09 });
        noise({ dur: 0.5, type: 'lowpass', freq: 900, gain: 0.13, sweepTo: 160 });
        tone({ at: 0.36, freq: 1180, type: 'triangle', dur: 0.35, gain: 0.05 });
    },

    /**
     * One chamber turning over. Called once per notch rather than as a single
     * spin-down, so the sound and the picture advance together. `p` runs 0 to 1
     * across the sequence and weights the click, so the last few land hardest.
     */
    chamberAdvance(p = 0) {
        mechClick(0, 0.7 + p * 0.8);
    },

    hammerCock() {
        mechClick(0, 1.4);
        mechClick(0.09, 1.1);
    },

    /** survived */
    dryFire() {
        mechClick(0, 1.8);
        noise({ at: 0.02, dur: 0.5, type: 'lowpass', freq: 700, gain: 0.06, sweepTo: 200 });
        tone({ at: 0.16, freq: 500, type: 'sine', dur: 0.4, gain: 0.05 });
        tone({ at: 0.24, freq: 750, type: 'sine', dur: 0.45, gain: 0.045 });
    },

    /** did not survive */
    gunshot() {
        noise({ dur: 0.42, type: 'lowpass', freq: 8000, gain: 0.75, sweepTo: 260 });
        noise({ at: 0.005, dur: 0.16, type: 'highpass', freq: 3000, gain: 0.45 });
        tone({ freq: 130, to: 28, type: 'sawtooth', dur: 0.5, gain: 0.4 });
        tone({ at: 0.01, freq: 62, to: 20, type: 'sine', dur: 0.7, gain: 0.35 });
        // tail slap
        noise({ at: 0.13, dur: 0.7, type: 'lowpass', freq: 1600, gain: 0.13, sweepTo: 180 });
    },

    eliminate() {
        tone({ at: 0.1, freq: 180, to: 44, type: 'sawtooth', dur: 1.1, gain: 0.14 });
        noise({ at: 0.1, dur: 1.0, type: 'lowpass', freq: 500, gain: 0.1, sweepTo: 90 });
    },

    /** your turn */
    turnAlert() {
        tone({ freq: 784, type: 'sine', dur: 0.18, gain: 0.1 });
        tone({ at: 0.11, freq: 1175, type: 'sine', dur: 0.3, gain: 0.09 });
        noise({ at: 0.02, dur: 0.25, type: 'bandpass', freq: 5200, q: 2, gain: 0.05 });
    },

    /** countdown pip */
    tick(urgent = false) {
        tone({ freq: urgent ? 1400 : 1000, type: 'square', dur: 0.045, gain: urgent ? 0.09 : 0.05 });
    },

    newRound() {
        [523, 659, 784].forEach((f, i) =>
            tone({ at: i * 0.07, freq: f, type: 'triangle', dur: 0.3, gain: 0.07 }),
        );
    },

    victory() {
        [523, 659, 784, 1047, 1319].forEach((f, i) =>
            tone({ at: i * 0.1, freq: f, type: 'triangle', dur: 0.8, gain: 0.11 }),
        );
        noise({ at: 0.05, dur: 1.4, type: 'bandpass', freq: 4200, q: 1.4, gain: 0.05 });
    },

    defeat() {
        [440, 392, 330, 262].forEach((f, i) =>
            tone({ at: i * 0.16, freq: f, type: 'sawtooth', dur: 0.7, gain: 0.08 }),
        );
    },

    toast() {
        tone({ freq: 1046, type: 'sine', dur: 0.09, gain: 0.05 });
    },

    error() {
        tone({ freq: 200, to: 130, type: 'square', dur: 0.16, gain: 0.08 });
    },

    join() {
        tone({ freq: 660, type: 'sine', dur: 0.14, gain: 0.07 });
        tone({ at: 0.09, freq: 990, type: 'sine', dur: 0.2, gain: 0.06 });
    },

    leave() {
        tone({ freq: 660, to: 330, type: 'sine', dur: 0.3, gain: 0.06 });
    },
};
