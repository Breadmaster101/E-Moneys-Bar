/**
 * motion.js: one answer to "should this move?", for JS and CSS alike.
 *
 * The OS preference is the default and stays the default: someone who has asked
 * their machine for less motion gets less motion without touching anything here.
 * But it was the *only* input, and a preference nobody can see or override is
 * indistinguishable from a broken effect. Windows turns it on as part of a
 * general "animation effects" switch, and the result was a revolver whose lethal
 * shot and blank round painted exactly the same frames — no flash, no recoil, no
 * vignette, the whole impact silently gated off with nothing in the UI to say so
 * or to take it back.
 *
 * So the preference is now a default rather than a verdict. `auto` follows the
 * machine; `full` and `reduced` are the player saying otherwise, and they stick.
 *
 * CSS reads the same decision through `data-motion` on <html>, which is only
 * written for the two explicit choices. Under `auto` the attribute is absent and
 * the media query in effects.css governs on its own, so the correct behaviour is
 * in force before this module has run at all and there is no frame in which
 * something moves that should not have.
 */

const STORAGE_KEY = 'emb.motion';
const VALID = ['auto', 'full', 'reduced'];

const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    ?? { matches: false, addEventListener() {} };

const stored = localStorage.getItem(STORAGE_KEY);
let pref = VALID.includes(stored) ? stored : 'auto';

/** What the machine asked for, ignoring any override. */
export const systemPrefersReduced = () => query.matches;

/** @returns {'auto'|'full'|'reduced'} */
export const motionPref = () => pref;

/** The decision itself: the one thing the rest of the app should ask. */
export const reducedMotion = () => (pref === 'auto' ? query.matches : pref === 'reduced');

function paint() {
    // absent under `auto`, so the stylesheet falls back to the media query
    if (pref === 'auto') delete document.documentElement.dataset.motion;
    else document.documentElement.dataset.motion = pref;
}

export function setMotionPref(next) {
    pref = VALID.includes(next) ? next : 'auto';
    if (pref === 'auto') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
    paint();
    return pref;
}

/**
 * Flip to the opposite of what is on screen right now. Always lands on an
 * explicit value: the point of pressing the button is to stop deferring.
 */
export function toggleMotion() {
    setMotionPref(reducedMotion() ? 'full' : 'reduced');
    return reducedMotion();
}

// only meaningful under `auto`, where the machine is still the one deciding
query.addEventListener?.('change', () => { if (pref === 'auto') paint(); });

paint();
