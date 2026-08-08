/**
 * fx.js — screen impact: particles on a full-screen canvas, camera shake,
 * and colour flashes. Everything is opt-out under prefers-reduced-motion.
 */

import { el } from './dom.js';

const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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

let lastT = 0;
function frame(t) {
    const dt = Math.min((t - lastT) / 1000 || 0.016, 0.05);
    lastT = t;

    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life += dt;
        if (p.life >= p.maxLife) {
            particles.splice(i, 1);
            continue;
        }

        p.vy += p.gravity * dt;
        p.vx *= Math.pow(p.drag, dt * 60);
        p.vy *= Math.pow(p.drag, dt * 60);
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;

        const k = 1 - p.life / p.maxLife;
        ctx.globalAlpha = Math.max(0, Math.min(1, k * (p.alphaScale ?? 1)));

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

export function muzzleFlash(x, y) {
    if (reduced) return;
    // hot sparks
    for (let i = 0; i < 46; i++) {
        const a = rand(-Math.PI, Math.PI);
        const speed = rand(180, 820);
        spawn({
            x, y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed - 60,
            size: rand(2, 6),
            maxLife: rand(0.35, 0.95),
            gravity: 900,
            drag: 0.93,
            color: ['#fff6d8', '#ffd27a', '#ff9d3c', '#ff5a2a'][i % 4],
            shape: 'streak',
            glow: 10,
            shrink: true,
        });
    }
    // smoke
    for (let i = 0; i < 18; i++) {
        const a = rand(-Math.PI, Math.PI);
        spawn({
            x: x + rand(-8, 8), y: y + rand(-8, 8),
            vx: Math.cos(a) * rand(20, 90),
            vy: Math.sin(a) * rand(20, 90) - 40,
            size: rand(8, 20),
            maxLife: rand(1.1, 2.0),
            gravity: -30,
            drag: 0.97,
            color: 'rgba(190,180,175,0.5)',
            grow: 26,
            alphaScale: 0.55,
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
}

export function smokePuff(x, y) {
    if (reduced) return;
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
    if (reduced) return;
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
    if (reduced) return;
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

/** Warm embers drifting up — used behind the winner. */
export function embers(count = 40) {
    if (reduced) return;
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

export function shake(amplitude = 10) {
    if (reduced) return;
    const root = document.documentElement;
    root.style.setProperty('--shake-amp', `${amplitude}px`);
    root.classList.remove('is-shaking');
    void root.offsetWidth; // restart the animation
    root.classList.add('is-shaking');
    clearTimeout(shakeTimer);
    shakeTimer = setTimeout(() => root.classList.remove('is-shaking'), 460);
}

let flashTimer = null;

export function flash(color = '#ffffff', alpha = 0.55, fadeMs = 420) {
    if (reduced) return;
    const node = el.fxFlash;
    clearTimeout(flashTimer);
    node.style.transition = 'none';
    node.style.background = color;
    node.style.opacity = String(alpha);
    // setTimeout, not rAF: a backgrounded tab would otherwise be left with a
    // full-screen white overlay stuck at full opacity.
    setTimeout(() => {
        node.style.transition = `opacity ${fadeMs}ms cubic-bezier(.16,1,.3,1)`;
        node.style.opacity = '0';
    }, 16);
    flashTimer = setTimeout(() => {
        node.style.transition = 'none';
    }, fadeMs + 40);
}
