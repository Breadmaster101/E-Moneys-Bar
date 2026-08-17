/**
 * fx.js: screen impact: particles on a full-screen canvas, camera shake,
 * and colour flashes. Everything is opt-out under prefers-reduced-motion.
 */

import { el } from './dom.js';
import { reducedMotion } from './motion.js';

// asked per call, not cached at load: the preference is now something the
// player can change mid-game from the topbar
const reduced = () => reducedMotion();

const canvas = el.fxCanvas;
const ctx = canvas.getContext('2d');

let particles = [];
let running = false;
let dpr = 1;

function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resize();
window.addEventListener('resize', resize);

const rand = (a, b) => a + Math.random() * (b - a);

function spawn(p) {
    particles.push({
        x: 0, y: 0, vx: 0, vy: 0,
        size: 3, life: 0, maxLife: 1,
        gravity: 0, drag: 0.98,
        color: '#fff', shape: 'circle',
        rot: 0, vr: 0, glow: 0,
        ...p,
    });
    // the loop is paused while the tab is hidden; don't let bursts pile up
    if (particles.length > 1200) particles.splice(0, particles.length - 1200);
    start();
}

function start() {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
}

/*
 * Hitstop. While the clock is held every particle keeps its position and its
 * age, so the peak frame of a burst sits on screen instead of being integrated
 * straight through. A gunshot that resolves smoothly reads as a light turning
 * on; the pause is what makes it read as an impact, and it is the same trick a
 * fighting game uses on a connecting hit.
 *
 * Held here rather than by delaying the spawn so that the flash, the sparks and
 * the smoke all freeze on the same frame: they are one event, and staggering
 * them would just be a slower effect.
 */
let freezeUntil = 0;

export function freeze(ms = 70) {
    if (reduced()) return;
    freezeUntil = performance.now() + ms;
    start();
}

let lastT = 0;
function frame(t) {
    /*
     * lastT advances even while frozen. Skipping it would bank the held time
     * into one enormous dt on release, which teleports every particle to where
     * it would have been anyway and throws the pause away.
     */
    const dt = t < freezeUntil ? 0 : Math.min((t - lastT) / 1000 || 0.016, 0.05);
    lastT = t;

    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
            particles.splice(i, 1);
            continue;
        }

        p.vx += (p.wind ?? 0) * dt;
        p.vy += p.gravity * dt;
        p.vx *= Math.pow(p.drag, dt * 60);
        p.vy *= Math.pow(p.drag, dt * 60);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;

        /*
         * Anything with a floor set lands on it instead of falling through the
         * dialog. Sparks and the ejected casing are the only things that use it:
         * debris that comes to rest somewhere is what places the shot in the
         * room rather than on a canvas floating over it.
         */
        if (p.floorY != null && p.y >= p.floorY && p.vy > 0) {
            p.y = p.floorY;
            p.vy *= -(p.bounce ?? 0.42);
            p.vx *= 0.6;
            p.vr *= 0.45;
            // once it stops bouncing let it lie there for the rest of its life
            if (Math.abs(p.vy) < 45) {
                p.vy = 0;
                p.vx *= 0.25;
                p.gravity = 0;
                p.floorY = null;
            }
        }

        const k = 1 - p.life / p.maxLife;
        // smoke has to build before it thins, or it appears at full density
        const rampIn = p.fadeIn ? Math.min(1, p.life / p.fadeIn) : 1;
        ctx.globalAlpha = Math.max(0, Math.min(1, k * rampIn * (p.alphaScale ?? 1)));

        if (p.glow) {
            ctx.shadowBlur = p.glow;
            ctx.shadowColor = p.color;
        } else {
            ctx.shadowBlur = 0;
        }

        ctx.fillStyle = p.color;

        if (p.shape === 'rect') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.rot);
            ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
            ctx.restore();
        } else if (p.shape === 'streak') {
            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(Math.atan2(p.vy, p.vx));
            ctx.fillRect(0, -p.size / 6, p.size * (0.5 + k), p.size / 3);
            ctx.restore();
        } else {
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size * (p.shrink ? k : 1) + (p.grow ? (1 - k) * p.grow : 0), 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;

    if (particles.length) {
        requestAnimationFrame(frame);
    } else {
        running = false;
    }
}

/** Centre point of an element, in viewport coordinates. */
export function centerOf(node) {
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/* ------------------------------------------------------------------ */
/* emitters                                                            */
/* ------------------------------------------------------------------ */

/**
 * The shot, in viewport space.
 *
 * Built in layers that come and go at different rates, because a single burst
 * that fades out evenly is what made the old flash read as gentle: the core is
 * gone in three frames, the sparks arc and land, and the smoke is still there
 * seconds later. The aftermath is doing as much work as the flash is.
 *
 * Nothing here is radially symmetric. Every burst is fanned around a random axis
 * and given a few outsized spikes, so no two shots in a game paint the same
 * picture even though the timing is identical.
 *
 * @param {number} x muzzle centre
 * @param {number} y muzzle centre
 * @param {{floorY?: number}} [opts] floorY: where debris comes to rest
 */
export function muzzleFlash(x, y, opts = {}) {
    if (reduced()) return;
    const floorY = opts.floorY ?? null;
    // the axis this particular shot throws along: fans hang off it below
    const axis = rand(-Math.PI, Math.PI);

    /*
     * Blown-out core. White and dead within about four frames: this is the part
     * that is over before you can look at it, which is exactly why the shot
     * registers as bright rather than as glowing.
     *
     * Kept to roughly a chamber's width. These are viewport pixels and the
     * revolver renders at about one pixel per viewBox unit, so radii of 16 to 30
     * were painting a white disc wider than the cylinder from a point that is
     * meant to be one chamber mouth.
     */
    for (let i = 0; i < 7; i++) {
        spawn({
            x: x + rand(-3, 3), y: y + rand(-3, 3),
            vx: rand(-40, 40), vy: rand(-40, 40),
            size: rand(7, 13),
            maxLife: rand(0.05, 0.1),
            drag: 0.85,
            color: '#ffffff',
            glow: 22,
            shrink: true,
        });
    }

    // hot sparks, fanned rather than circular, and they land
    for (let i = 0; i < 64; i++) {
        // most of them inside a 120-degree fan, a few thrown anywhere
        const a = i % 9 === 0 ? rand(-Math.PI, Math.PI) : axis + rand(-1.05, 1.05);
        const speed = i % 11 === 0 ? rand(900, 1500) : rand(220, 900);
        spawn({
            x, y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed - 80,
            size: rand(2, 7),
            maxLife: rand(0.35, 1.15),
            gravity: 1100,
            drag: 0.93,
            color: ['#fff6d8', '#ffd27a', '#ff9d3c', '#ff5a2a'][i % 4],
            shape: 'streak',
            glow: 10,
            shrink: true,
            floorY,
            bounce: 0.35,
        });
    }

    /*
     * The plume: unburnt powder pushed out of the barrel towards the viewer, so
     * it grows in place instead of travelling. Tinted warm while it is lit by
     * the flash it came out of.
     *
     * Which is the constraint on how long it can live: it is only warm because
     * something is lighting it, and that light is now gone in about 170ms. At
     * 0.4s it outlasted the flash and went on glowing on its own, so it became
     * the slowest bright thing at the muzzle and took the speed out of the shot
     * it was supposed to be trailing. Past this it is grey, which is the smoke
     * below.
     */
    for (let i = 0; i < 14; i++) {
        const a = axis + rand(-0.8, 0.8);
        spawn({
            x: x + rand(-6, 6), y: y + rand(-6, 6),
            vx: Math.cos(a) * rand(30, 150),
            vy: Math.sin(a) * rand(30, 150),
            size: rand(7, 15),
            maxLife: rand(0.12, 0.22),
            drag: 0.9,
            color: 'rgba(255,196,110,0.5)',
            grow: 26,
            alphaScale: 0.8,
        });
    }

    /*
     * Smoke that outlives the shot. Long-lived, drifting on a light wind and
     * rising: the table is still looking at it when the result text lands, which
     * is what sells the shot as something that happened to the room.
     */
    const wind = rand(-40, 40);
    for (let i = 0; i < 26; i++) {
        const a = rand(-Math.PI, Math.PI);
        spawn({
            x: x + rand(-10, 10), y: y + rand(-10, 10),
            vx: Math.cos(a) * rand(20, 90),
            vy: Math.sin(a) * rand(20, 90) - 60,
            size: rand(8, 22),
            maxLife: rand(2.4, 4.2),
            gravity: -26,
            drag: 0.965,
            wind,
            color: 'rgba(190,180,175,0.5)',
            grow: 46,
            fadeIn: 0.18,
            alphaScale: 0.5,
        });
    }
    // three big soft puffs to give the plume some mass
    for (let i = 0; i < 3; i++) {
        spawn({
            x: x + rand(-14, 14), y: y + rand(-12, 4),
            vx: rand(-30, 30), vy: rand(-70, -25),
            size: rand(24, 38),
            maxLife: rand(3.0, 4.4),
            gravity: -18,
            drag: 0.97,
            wind,
            color: 'rgba(176,168,162,0.42)',
            grow: 80,
            fadeIn: 0.5,
            alphaScale: 0.38,
        });
    }

    // blood-red ring
    for (let i = 0; i < 22; i++) {
        const a = (i / 22) * Math.PI * 2;
        spawn({
            x, y,
            vx: Math.cos(a) * 420,
            vy: Math.sin(a) * 420,
            size: 4,
            maxLife: 0.5,
            drag: 0.9,
            color: '#ff2f4e',
            glow: 14,
            shrink: true,
        });
    }

    /*
     * The spent case, tumbling out and coming to rest. One piece of debris that
     * obeys ordinary physics does more for the weight of the thing than another
     * fifty sparks would: it is the only part of the effect that is still on
     * screen, sitting still, after everything else has gone.
     */
    spawn({
        x, y: y + 4,
        vx: rand(120, 300) * (Math.random() < 0.5 ? -1 : 1),
        vy: rand(-320, -180),
        size: rand(7, 9),
        maxLife: 2.6,
        gravity: 1300,
        drag: 0.995,
        color: '#c9a961',
        shape: 'rect',
        rot: rand(0, Math.PI * 2),
        vr: rand(-16, 16),
        floorY,
        bounce: 0.45,
    });
}

export function smokePuff(x, y) {
    if (reduced()) return;
    for (let i = 0; i < 16; i++) {
        const a = rand(-Math.PI, Math.PI);
        spawn({
            x: x + rand(-6, 6), y: y + rand(-6, 6),
            vx: Math.cos(a) * rand(15, 70),
            vy: Math.sin(a) * rand(15, 70) - 55,
            size: rand(6, 16),
            maxLife: rand(1.0, 1.9),
            gravity: -40,
            drag: 0.97,
            color: 'rgba(200,225,215,0.42)',
            grow: 22,
            alphaScale: 0.6,
        });
    }
    for (let i = 0; i < 10; i++) {
        const a = rand(-Math.PI, Math.PI);
        spawn({
            x, y,
            vx: Math.cos(a) * rand(90, 260),
            vy: Math.sin(a) * rand(90, 260),
            size: rand(2, 4),
            maxLife: rand(0.3, 0.6),
            drag: 0.9,
            color: '#4be08a',
            glow: 10,
            shrink: true,
        });
    }
}

export function sparks(x, y, color = '#ffb44d', count = 18) {
    if (reduced()) return;
    for (let i = 0; i < count; i++) {
        const a = rand(-Math.PI, Math.PI);
        const speed = rand(90, 340);
        spawn({
            x, y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            size: rand(1.5, 3.5),
            maxLife: rand(0.3, 0.7),
            gravity: 500,
            drag: 0.93,
            color,
            glow: 8,
            shrink: true,
        });
    }
}

export function confetti() {
    if (reduced()) return;
    const colors = ['#ffb44d', '#ffd79a', '#4fe3ff', '#ff5f9e', '#7bea6a', '#ffffff'];
    const w = window.innerWidth;
    for (let i = 0; i < 130; i++) {
        spawn({
            x: rand(0, w),
            y: rand(-260, -20),
            vx: rand(-90, 90),
            vy: rand(90, 320),
            size: rand(6, 13),
            maxLife: rand(2.4, 4.2),
            gravity: 240,
            drag: 0.995,
            color: colors[i % colors.length],
            shape: 'rect',
            rot: rand(0, Math.PI * 2),
            vr: rand(-9, 9),
        });
    }
}

/** Warm embers drifting up: used behind the winner. */
export function embers(count = 40) {
    if (reduced()) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (let i = 0; i < count; i++) {
        spawn({
            x: rand(0, w),
            y: h + rand(0, 120),
            vx: rand(-25, 25),
            vy: rand(-120, -40),
            size: rand(1.5, 3.5),
            maxLife: rand(2.5, 5),
            drag: 0.999,
            color: ['#ffb44d', '#ff8c3c', '#ffd79a'][i % 3],
            glow: 10,
            shrink: true,
        });
    }
}

/* ------------------------------------------------------------------ */
/* camera                                                              */
/* ------------------------------------------------------------------ */

let shakeTimer = null;
let shakeRaf = 0;

function clearShake() {
    const root = document.documentElement;
    cancelAnimationFrame(shakeRaf);
    clearTimeout(shakeTimer);
    root.classList.remove('is-shaking');
    root.style.setProperty('--shake-x', '0px');
    root.style.setProperty('--shake-y', '0px');
    root.style.setProperty('--shake-r', '0deg');
}

/**
 * Kick the camera.
 *
 * Driven per frame from here rather than by a CSS keyframe, because a keyframe
 * plays the identical six offsets every time: fire twice in a game and the
 * second shot is visibly the same wobble as the first, which is the tell that
 * turns an impact back into an animation. The phases are re-rolled per call, so
 * the shape of the shake is different every shot while the envelope, which is
 * the part you actually feel, stays the same.
 *
 * The envelope decays steeply: almost all of the travel is in the first third.
 * A shot is one impulse settling, not a shudder.
 */
export function shake(amplitude = 10, ms = 460) {
    if (reduced()) return;
    const root = document.documentElement;
    clearShake();
    root.classList.add('is-shaking');

    const start = performance.now();
    const p1 = rand(0, Math.PI * 2);
    const p2 = rand(0, Math.PI * 2);
    const p3 = rand(0, Math.PI * 2);

    const step = (t) => {
        const e = (t - start) / ms;
        if (e >= 1) {
            clearShake();
            return;
        }
        const decay = Math.pow(1 - e, 2.4);
        const a = amplitude * decay;
        const ms_ = t - start;
        root.style.setProperty('--shake-x', `${(a * Math.sin(ms_ * 0.085 + p1)).toFixed(2)}px`);
        root.style.setProperty('--shake-y', `${(a * 0.8 * Math.sin(ms_ * 0.113 + p2)).toFixed(2)}px`);
        root.style.setProperty('--shake-r', `${(a * 0.045 * Math.sin(ms_ * 0.071 + p3)).toFixed(3)}deg`);
        shakeRaf = requestAnimationFrame(step);
    };
    shakeRaf = requestAnimationFrame(step);

    /*
     * rAF does not run in a hidden tab, which would leave #app parked at
     * whatever offset the last frame set. This is the only thing that puts it
     * back, so it is not optional.
     */
    shakeTimer = setTimeout(clearShake, ms + 400);
}

let flashTimers = [];

function clearFlashTimers() {
    flashTimers.forEach(clearTimeout);
    flashTimers = [];
}

export function flash(color = '#ffffff', alpha = 0.55, fadeMs = 420) {
    if (reduced()) return;
    const node = el.fxFlash;
    clearFlashTimers();
    node.style.transition = 'none';
    node.style.background = color;
    node.style.opacity = String(alpha);
    // setTimeout, not rAF: a backgrounded tab would otherwise be left with a
    // full-screen white overlay stuck at full opacity.
    flashTimers.push(setTimeout(() => {
        node.style.transition = `opacity ${fadeMs}ms cubic-bezier(.16,1,.3,1)`;
        node.style.opacity = '0';
    }, 16));
    flashTimers.push(setTimeout(() => {
        node.style.transition = 'none';
    }, fadeMs + 40));
}

/**
 * A blow-out, then the colour.
 *
 * flash() eases a tinted wash away over a quarter of a second, and an eased
 * curve has no moment in it: the brightest frame is the first one and by then
 * the fade has already started. This clips to white and holds it flat for a
 * couple of frames before handing over to the warm falloff, so there is an
 * instant to register and a decay to watch. Intensity is the step, not the ramp.
 */
export function flashPunch(color = '#ffdca8', alpha = 0.85, fadeMs = 260, coreMs = 55) {
    if (reduced()) return;
    const node = el.fxFlash;
    clearFlashTimers();
    node.style.transition = 'none';
    node.style.background = '#ffffff';
    node.style.opacity = '0.98';

    flashTimers.push(setTimeout(() => {
        node.style.transition = 'none';
        node.style.background = color;
        node.style.opacity = String(alpha);
    }, coreMs));
    flashTimers.push(setTimeout(() => {
        node.style.transition = `opacity ${fadeMs}ms cubic-bezier(.16,1,.3,1)`;
        node.style.opacity = '0';
    }, coreMs + 16));
    flashTimers.push(setTimeout(() => {
        node.style.transition = 'none';
    }, coreMs + fadeMs + 40));
}

/**
 * The aftermath: dark red closing in from the edges, twice, like a pulse.
 *
 * Replaces a flat 22%-red wash over the whole viewport. The wash was covering
 * the table at the exact moment the table wants to look at it, and a constant
 * tint carries no dread anyway. Two beats of a vignette do, and they leave the
 * middle of the screen alone.
 *
 * WAAPI rather than CSS for the reason the cylinder uses it: the reduced-motion
 * block in effects.css clamps every CSS animation to 0.01ms, and this is gated
 * on that preference here instead.
 */
export function bloodVignette(peak = 0.9, ms = 1500) {
    if (reduced()) return;
    const node = el.fxBlood;
    node.getAnimations?.().forEach((a) => a.cancel());
    node.animate(
        [
            { opacity: 0, offset: 0 },
            { opacity: peak, offset: 0.12 },
            { opacity: peak * 0.34, offset: 0.4 },
            { opacity: peak * 0.78, offset: 0.62 },
            { opacity: 0, offset: 1 },
        ],
        { duration: ms, easing: 'ease-in-out' },
    );
}
