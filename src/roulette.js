/**
 * roulette.js: the game's big moment, as a cylinder that indexes round.
 *
 * The cylinder never free-spins. It advances one chamber at a time, with a
 * click for each, because the gun does not get re-randomised between shots:
 * each player's revolver is a six-item deck that gets popped from, so the odds
 * climb as it empties. Spent chambers stay struck out and the live rounds stay
 * visible, which means the table can count what is left. Which of those rounds
 * is the live one is the only thing hidden.
 *
 * Timeline (ms), planned by planRoulette() in constants.js:
 *      0   modal opens, cards flip up
 *    260   cylinder starts indexing, one notch and one click at a time,
 *          at least a full revolution, landing on a chamber that still
 *          holds a round
 *      +   holds there for 2 to 5 seconds
 *      +   the index mark strikes: bang or click, and that round is gone
 *      +   result text, Continue enabled
 *
 * The variable beats come from a seed the host broadcasts, so every client
 * runs the identical sequence and the host knows exactly when it ends.
 */

import { el, openModal } from './dom.js';
import { reducedMotion } from './motion.js';
import { REVOLVER_CHAMBERS, SUIT_SYMBOLS, ROULETTE_LEAD_IN_MS, planRoulette } from './constants.js';
import { localPlayer } from './state.js';
import { createCard } from './cards.js';
import { sfx } from './audio.js';
import * as fx from './fx.js';
import { addLog } from './log.js';

const NS = 'http://www.w3.org/2000/svg';
let timers = [];
let spin = null;

const after = (ms, fn) => timers.push(setTimeout(fn, ms));

function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
    spin?.cancel();
    spin = null;
    /*
     * Every notch creates its own animation, so cancelling the last one is not
     * enough: cancel whatever is still attached to the stage. Cheap, and it
     * means leaving the table part-way through a sequence cannot leave a
     * half-turned cylinder behind.
     */
    el.revolverStage?.querySelectorAll('*').forEach((node) => {
        node.getAnimations?.().forEach((a) => a.cancel());
    });
    /*
     * The shot leaves two classes on the stage, and one of them is a filter.
     * Walking out of the table during the 130ms the punch is up would otherwise
     * leave the revolver blown out and channel-split for as long as the dialog
     * lives, so the teardown that cancels the animations drops these too.
     */
    el.revolverStage?.classList.remove('is-firing', 'is-punched');
}

function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}

// re-exported shape kept identical; the decision now lives in motion.js so the
// topbar toggle reaches the revolver as well as the particles

/**
 * How long the picture is held at the moment of the shot, in ms.
 *
 * The freeze is the reason the rest of this reads as an impact. Everything
 * arrives on one frame and then nothing moves for a fraction of a second: the
 * eye gets an instant to take the peak in, and the release afterwards lands
 * against something. Long enough to register, short enough that it is felt
 * rather than seen as a stutter.
 *
 * Came down from 70ms with the rest of the envelope. A hold is dead air, and it
 * only reads as weight while the decay after it is long enough to be worth
 * bracing for; against a release that is now a quarter of what it was, 70ms of
 * nothing moving was most of the effect and it read as the frame having dropped.
 */
const HITSTOP_MS = 45;

const rand = (a, b) => a + Math.random() * (b - a);

/**
 * The muzzle spikes, cut fresh for this shot.
 *
 * A flash seen down the barrel is a ragged star, not a disc, and the raggedness
 * has to differ per shot or the sixth one is visibly the same picture as the
 * first. Each spike is a triangle with its base on the muzzle and its tip out in
 * the dark, rotated onto its own angle; the gradient runs base-to-tip inside
 * each one's own box, so it is hot where it leaves the chamber and gone by the
 * point no matter which way it is turned.
 *
 * Lengths are set against the chamber, which is r18 in viewBox units: the long
 * spike reaches about three chamber radii and the rest under two, so the widest
 * star a shot can cut is a little over two chamber diameters across. Spikes that
 * ran to 150 units put the star across the whole cylinder, which stopped reading
 * as light coming out of one hole and started reading as the gun being lit.
 */
function cutRays(rays) {
    rays.innerHTML = '';
    const count = Math.round(rand(4, 7));
    const base = rand(0, Math.PI * 2);

    for (let i = 0; i < count; i++) {
        // spread around the circle, then knocked off it, so they are neither
        // evenly spaced nor clumped
        const angle = (base + (i / count) * Math.PI * 2 + rand(-0.34, 0.34)) * (180 / Math.PI);
        // one spike per shot is a long one: an even star reads as a decoration
        const len = i === 0 ? rand(34, 52) : rand(14, 32);
        const half = rand(2.5, 6);

        rays.appendChild(svgEl('path', {
            d: `M${100 - half} 62 L100 ${62 - len} L${100 + half} 62 Z`,
            transform: `rotate(${angle.toFixed(1)} 100 62)`,
            fill: 'url(#grad-muzzle-cone)',
        }));
    }
}

/**
 * Fire the flash: the held peak, then the release.
 *
 * Driven by the Web Animations API, not CSS animations, for the same reason the
 * cylinder is: `effects.css` clamps every CSS `animation-duration` to 0.01ms
 * under prefers-reduced-motion, which silently reduced this to a flash nobody
 * could see. Honouring that preference is right, but it has to be an explicit
 * choice rather than an animation that fires and paints nothing, so the check is
 * done here and the timing is set in JS where nothing can rewrite it. Matches
 * how `fx.js` gates its particles.
 *
 * The one bloom this used to be is now the slowest of five layers, and the
 * fastest of them is gone in three frames. That spread is the whole difference:
 * a single 330ms ease has no instant in it to be startled by.
 *
 * @param {object} parts the flash nodes from buildRevolver
 * @param {() => void} onRelease run when the held frame breaks
 */
function fireMuzzleFlash({ flash, core, rays, shock, occlude }, onRelease) {
    if (reducedMotion()) {
        onRelease();
        return;
    }

    cutRays(rays);

    /*
     * The held frame, set rather than animated: for HITSTOP_MS the flash is a
     * still picture with the gun behind it. `fill: 'forwards'` on a zero-length
     * animation is what pins it there without touching inline styles, so the
     * release animations below start from a state nothing has to clean up.
     */
    const holds = [];
    const hold = (node, keyframe) =>
        holds.push(node.animate([keyframe], { duration: HITSTOP_MS, fill: 'forwards' }));

    hold(occlude, { opacity: 1 });
    hold(core, { opacity: 1, transform: 'scale(1.05)' });
    hold(flash, { opacity: 1, transform: 'scale(1.15)' });
    hold(rays, { opacity: 1, transform: 'scale(1)' });
    hold(shock, { opacity: 0, transform: 'scale(.3)' });

    // `after` rather than a bare setTimeout so leaving the table mid-shot takes
    // the release with it: clearTimers() owns everything this scene starts
    after(HITSTOP_MS, () => {
        /*
         * Drop the holds before animating out. They fill forwards, and a
         * forwards fill outranks a finished animation in the cascade: leaving
         * them in place would snap every layer back to full opacity the instant
         * the release ended, which is a flash that never goes away.
         */
        holds.forEach((a) => a.cancel());

        onRelease();

        /*
         * Durations are set by how far each layer actually travels, not picked
         * to feel right in isolation. Pinning the flash onto the chamber cut
         * every layer's travel by about three, and leaving these at their old
         * values cut the expansion rate by the same three: the picture was the
         * right size and crawled, because a bloom covering a quarter of the
         * ground in the same time is a quarter of the speed. Each one below is
         * back to roughly the units-per-ms it used to run at, which is the thing
         * the eye was reading as speed all along.
         */

        // the sheet of light goes first, uncovering the struck chamber
        occlude.animate(
            [{ opacity: 1 }, { opacity: 0 }],
            { duration: 80, easing: 'linear' },
        );
        // and the core with it: three frames, straight out, no curve
        core.animate(
            [
                { opacity: 1, transform: 'scale(1.05)' },
                { opacity: 0, transform: 'scale(1.9)' },
            ],
            { duration: 55, easing: 'linear' },
        );
        // the spikes collapse rather than fade: powder burning out
        rays.animate(
            [
                { opacity: 1, transform: 'scale(1)' },
                { opacity: .7, transform: 'scale(1.28)', offset: .3 },
                { opacity: 0, transform: 'scale(.42)' },
            ],
            { duration: 90, easing: 'cubic-bezier(.3,.7,.4,1)' },
        );
        /*
         * The hairline leaves the muzzle and keeps going. It ends at 3.4x of r10
         * rather than 5.4x of r18: the old ring finished wider than the frame,
         * so the last third of its travel was a hoop expanding around the whole
         * revolver rather than an edge leaving a barrel.
         */
        shock.animate(
            [
                { opacity: .95, transform: 'scale(.3)' },
                { opacity: 0, transform: 'scale(3.4)' },
            ],
            { duration: 170, easing: 'cubic-bezier(.1,.85,.25,1)' },
        );
        // the bloom is the only slow part, and now it is the tail rather than
        // the whole effect
        flash.animate(
            [
                { opacity: 1, transform: 'scale(1.15)' },
                { opacity: 0, transform: 'scale(2.4)' },
            ],
            { duration: 130, easing: 'cubic-bezier(.16,1,.3,1)' },
        );
    });
}

/* ------------------------------------------------------------------ */
/* the revolver                                                        */
/* ------------------------------------------------------------------ */

/**
 * Draw the cylinder face-on.
 *
 * There is no hammer. A hammer strikes the back of a chamber, so drawing one
 * from the side above a cylinder seen from the front was two viewpoints at
 * once, and it was the thing that read as wrong. Its job, marking which chamber
 * is up, is done by a fixed index mark at twelve o'clock that the cylinder
 * turns beneath.
 *
 * @param {number} spentCount how many chambers have already been fired
 */
function buildRevolver(spentCount) {
    el.revolverStage.innerHTML = '';
    el.revolverStage.classList.remove('is-firing', 'is-punched');

    const svg = svgEl('svg', { class: 'revolver-svg', viewBox: '0 0 200 200' });

    // frame
    svg.appendChild(svgEl('circle', {
        cx: '100', cy: '108', r: '84',
        fill: '#0a0908', stroke: 'rgba(201,169,97,.62)', 'stroke-width': '2',
    }));

    // transform-origin lives in modals.css: one source of truth
    const cylinder = svgEl('g', { class: 'revolver-cylinder' });

    cylinder.appendChild(svgEl('circle', {
        cx: '100', cy: '108', r: '76',
        fill: 'url(#grad-cyl-metal)', stroke: 'rgba(201,169,97,.34)', 'stroke-width': '1.5',
    }));
    cylinder.appendChild(svgEl('circle', {
        cx: '100', cy: '108', r: '64',
        fill: 'none', stroke: 'rgba(201,169,97,.16)', 'stroke-width': '1',
    }));

    /*
     * Chamber 0 starts under the mark and they run clockwise. Spent chambers
     * are the low indices, so they read as a block that has already gone by.
     *
     * Every unspent chamber gets an identical round: the table can see how many
     * are left, which is the whole tension, but not which one is live.
     */
    const rounds = [];
    const strikes = [];
    for (let i = 0; i < REVOLVER_CHAMBERS; i++) {
        const angle = (-90 + i * 60) * (Math.PI / 180);
        const cx = 100 + Math.cos(angle) * 46;
        const cy = 108 + Math.sin(angle) * 46;
        const spent = i < spentCount;

        cylinder.appendChild(svgEl('circle', {
            cx, cy, r: '18',
            fill: '#0a0908', stroke: 'rgba(201,169,97,.16)', 'stroke-width': '1',
        }));
        cylinder.appendChild(svgEl('circle', {
            cx, cy, r: '14',
            fill: 'none',
            stroke: spent ? 'rgba(201,169,97,.22)' : 'rgba(201,169,97,.45)',
            'stroke-width': '1.5',
        }));

        if (!spent) {
            const round = svgEl('circle', {
                cx, cy, r: '9', fill: '#c9a961', stroke: '#8a6f34', 'stroke-width': '1',
                class: 'revolver-round',
            });
            rounds[i] = round;
            cylinder.appendChild(round);
        }

        /*
         * The cross that marks a fired chamber. Drawn for every chamber, not
         * just the spent ones: the chamber that goes off during this sequence
         * needs one too, and it has to appear the instant the round leaves
         * rather than only on the next cylinder we build.
         *
         * Rotated onto its own spoke. The arms are plain diagonals in absolute
         * coordinates, so without this every cross points the same way and the
         * cylinder reads as six unrelated marks stamped on it. i * 60 is the
         * chamber's own angle off the top, which leaves each cross symmetric
         * about the line back to the centre pin.
         */
        const d = 9;
        const strike = svgEl('path', {
            d: `M${cx - d} ${cy - d} L${cx + d} ${cy + d} M${cx + d} ${cy - d} L${cx - d} ${cy + d}`,
            transform: `rotate(${i * 60} ${cx} ${cy})`,
            stroke: 'rgba(201,169,97,.22)', 'stroke-width': '1.5', fill: 'none',
            class: `revolver-strike${spent ? ' is-shown' : ''}`,
        });
        strikes[i] = strike;
        cylinder.appendChild(strike);
    }

    // centre pin
    cylinder.appendChild(svgEl('circle', {
        cx: '100', cy: '108', r: '11',
        fill: '#16130f', stroke: 'rgba(201,169,97,.34)', 'stroke-width': '1.5',
    }));

    svg.appendChild(cylinder);

    // the index mark, fixed: the cylinder turns under it
    const mark = svgEl('g', { class: 'revolver-mark' });
    mark.appendChild(svgEl('path', {
        d: 'M100 44 L91 26 L109 26 Z',
        fill: '#c9a961', stroke: '#8a6f34', 'stroke-width': '1',
    }));
    mark.appendChild(svgEl('path', {
        d: 'M86 20 H114',
        stroke: 'rgba(201,169,97,.45)', 'stroke-width': '1.5', fill: 'none',
    }));
    svg.appendChild(mark);

    /*
     * The muzzle flash, drawn in the SVG and sitting outside the cylinder group
     * so it does not turn with it.
     *
     * (100, 62) is the chamber under the index mark: the centre at (100, 108)
     * less the 46 chamber radius. Because it is a sibling in the same viewBox,
     * it is over the fired chamber by construction, and scales with the stage
     * for free. It was an absolutely positioned HTML div before, placed from JS
     * on every shot, which meant its position depended on the flash layer's
     * containing block, an inline style landing, and a getScreenCTM conversion.
     * All three had to be right and there was no way to check them.
     */
    /*
     * The spikes. Empty until the shot: their number, length, width and angles
     * are re-rolled in fireMuzzleFlash() so that consecutive shots do not paint
     * the same star, which is most of what stopped the old single circle from
     * reading as an event.
     */
    const rays = svgEl('g', { class: 'revolver-rays' });
    svg.appendChild(rays);

    // the shockwave leaving the muzzle: one hairline, expanding
    const shock = svgEl('circle', {
        class: 'revolver-shock', cx: '100', cy: '62', r: '10',
        fill: 'none', stroke: '#fff3cf', 'stroke-width': '2.4',
    });
    svg.appendChild(shock);

    const flash = svgEl('circle', {
        class: 'revolver-flash', cx: '100', cy: '62', r: '21',
        fill: 'url(#grad-muzzle)',
    });
    svg.appendChild(flash);

    // the clipped white centre, over the bloom
    const core = svgEl('circle', {
        class: 'revolver-core', cx: '100', cy: '62', r: '13',
        fill: 'url(#grad-muzzle-core)',
    });
    svg.appendChild(core);

    /*
     * Last, so it is over everything: the sheet of light that hides the chamber
     * for the couple of frames the shot takes. Appended after the cylinder
     * rather than composited under it on purpose, because an effect you can see
     * the mechanism through is an effect the eye discounts.
     *
     * On the muzzle, not on the frame. It used to be r104 about the centre pin,
     * which whited out all six chambers off one round going off; its actual job
     * is to hide the chamber that fired while the round vanishes and the cross
     * lands, and that chamber is r18 at the muzzle. r30 covers it with room for
     * the falloff and leaves the rest of the cylinder visible, so the flash
     * stays something happening at one hole in the gun.
     */
    const occlude = svgEl('circle', {
        class: 'revolver-occlude', cx: '100', cy: '62', r: '30',
        fill: 'url(#grad-muzzle-occlude)',
    });
    svg.appendChild(occlude);

    el.revolverStage.append(svg);
    return { svg, cylinder, mark, rounds, strikes, flash, core, rays, shock, occlude };
}

/* ------------------------------------------------------------------ */
/* the scene                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {object} data the CHALLENGE_ROULETTE_RESULTS payload
 * @param {object} targetAfter the target player's state after the shot
 */
export function playRoulette(data, targetAfter) {
    clearTimers();

    const lethal = data.rouletteOutcome === 'lethal';
    const targetIsMe = data.rouletteTarget.id === localPlayer.id;

    /* ---- header ---- */
    el.rouletteTitle.classList.remove('is-danger', 'is-good');
    el.revealedCards.innerHTML = '';

    if (data.isCardDepletion) {
        el.rouletteTitle.textContent = 'Hand empty';
        el.rouletteDetails.textContent =
            `${data.rouletteTarget.name} played their last card. The table wants proof of luck.`;
    } else {
        el.rouletteTitle.textContent = data.claimWasLie ? 'Caught lying' : 'Bad call';
        el.rouletteTitle.classList.add(data.claimWasLie ? 'is-danger' : 'is-good');
        el.rouletteDetails.textContent =
            `${data.challenger.name} called out ${data.accused.name}, `
            + `who claimed ${SUIT_SYMBOLS[data.tableSuit]} ${data.tableSuit}.`;

        (data.playedCards ?? []).forEach((card, i) => {
            const node = createCard(card, {
                className: card.suit === data.tableSuit ? 'is-truth' : 'is-lie',
            });
            node.style.setProperty('--reveal-delay', `${120 + i * 130}ms`);
            el.revealedCards.appendChild(node);
        });
    }

    el.rouletteConsequence.innerHTML = '';
    el.rouletteConsequence.append(
        Object.assign(document.createElement('b'), { textContent: data.rouletteTarget.name }),
        document.createTextNode(targetIsMe ? '. That is you. Spin it.' : ' takes the revolver.'),
    );

    el.rouletteResult.textContent = '';
    el.rouletteResult.className = 'roulette-result';
    el.continueBtn.disabled = true;

    /* ---- stage ---- */
    const plan = planRoulette({
        seed: data.rouletteSeed,
        chambersBefore: data.chambersBefore,
    });
    const parts = buildRevolver(plan.spentCount);
    const { svg, cylinder, mark, rounds, strikes } = parts;

    openModal(el.rouletteModal);

    if (!data.isCardDepletion) sfx.liar();

    /*
     * One notch at a time. Each step is its own animate() call from the angle
     * it is at to the next, rather than one long spin: the point is that you
     * can see and hear the cylinder index round, not that it blurs.
     *
     * WAAPI rather than a CSS transition throughout. A transition needs the
     * browser to have computed the "before" value in an earlier frame, and when
     * timers coalesce (a throttled or just-restored tab) the set lands in the
     * same frame as the insert and the cylinder jumps straight to its final
     * angle. animate() states both ends explicitly, so it cannot mis-fire.
     */
    /*
     * Fall back to clockwise rather than trusting the plan blindly. A missing or
     * junk direction multiplies out to NaN, `rotate(NaNdeg)` is invalid, and
     * WAAPI drops an invalid property without complaining: the animation still
     * runs, still reports "running", and turns nothing. That failure is silent
     * and looks exactly like the cylinder being broken, so it is worth a line to
     * make impossible.
     */
    const spinDir = plan.direction === -1 ? -1 : 1;

    let elapsed = ROULETTE_LEAD_IN_MS;
    plan.notchDurations.forEach((dur, i) => {
        after(elapsed, () => {
            const from = i * 60 * spinDir;
            const to = (i + 1) * 60 * spinDir;
            spin = cylinder.animate(
                [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }],
                {
                    // turn takes most of the beat, then it sits: that pause
                    // between notches is what makes it read as mechanical
                    duration: Math.round(dur * 0.55),
                    easing: 'cubic-bezier(.2,.85,.3,1)',
                    fill: 'forwards',
                },
            );
            sfx.chamberAdvance(i / Math.max(1, plan.notchDurations.length - 1));
        });
        elapsed += dur;
    });

    // the wait is over: the mark dips, and the cock is the only warning
    after(plan.fireAt - 120, () => {
        mark.classList.add('is-striking');
        sfx.hammerCock();
    });

    after(plan.fireAt, () => {
        /*
         * The flash itself needs no positioning: it is an SVG sibling pinned to
         * the fired chamber. This is only for the canvas particles, which live
         * in viewport space. getScreenCTM does the viewBox-to-screen mapping
         * including the preserveAspectRatio letterboxing, so it holds at any
         * stage size.
         */
        const shot = new DOMPoint(100, 62).matrixTransform(svg.getScreenCTM());
        const shotX = shot.x;
        const shotY = shot.y;
        // where sparks and the spent case come to rest: the foot of the stage,
        // so debris settles inside the scene instead of falling past the dialog
        const floorY = el.revolverStage.getBoundingClientRect().bottom - 4;

        /*
         * That round is gone, whichever way it went. Spending it here rather
         * than drawing the cylinder post-shot is what ties the picture to the
         * rules: the chamber you were just looking at is now one of the struck
         * ones, and next time round there is one fewer.
         *
         * On a lethal shot this happens underneath the occluder, so the cross
         * and the empty chamber are already there when the light clears rather
         * than appearing in front of it. The change is hidden inside the event.
         */
        const spendRound = () => {
            rounds[plan.landingChamber]?.classList.add('is-spent');
            strikes[plan.landingChamber]?.classList.add('is-shown');
            mark.classList.remove('is-striking');
        };

        if (lethal) {
            /*
             * Everything below lands on this one frame: the audio transient, the
             * peak of the flash and the first particle. A few milliseconds of
             * drift between the bang and the picture is the difference between a
             * gunshot and a cartoon, so none of it is deferred and the recoil is
             * the only part that waits.
             *
             * No fx.flashPunch here. That was a full-viewport wash, which put
             * the brightest part of the shot everywhere except the barrel and
             * covered the revolver at the one moment the table is looking at it.
             * The blow-out now happens where the round does: the occluder over
             * the fired chamber, and the exposure punch on the gun below.
             */
            sfx.gunshot();
            /*
             * Gated here rather than in the stylesheet. The reduced-motion block
             * in effects.css only clamps animations, and this is a static filter:
             * it would sit there blowing the revolver out at 150% brightness for
             * everyone who asked for less, which is the opposite of the ask.
             */
            if (!reducedMotion()) el.revolverStage.classList.add('is-punched');
            fx.muzzleFlash(shotX, shotY, { floorY });
            fx.freeze(HITSTOP_MS);
            spendRound();

            /*
             * The kick and the camera come out of the freeze, not into it. Held
             * first, then thrown: the shake reads as the release of something
             * that was stopped rather than as a wobble that happened to start.
             */
            fireMuzzleFlash(parts, () => {
                el.revolverStage.style.setProperty(
                    '--recoil-x', `${(Math.random() < 0.5 ? -1 : 1) * (7 + Math.random() * 6)}px`,
                );
                el.revolverStage.classList.add('is-firing');
                fx.shake(targetIsMe ? 30 : 19);
            });

            after(HITSTOP_MS + 60, () => el.revolverStage.classList.remove('is-punched'));
            after(300, () => fx.bloodVignette(targetIsMe ? 0.95 : 0.7, 1500));
            after(180, () => sfx.eliminate());
        } else {
            sfx.dryFire();
            fx.shake(6);
            fx.smokePuff(shotX, shotY);
            spendRound();
        }
    });

    after(plan.fireAt + 260, () => {
        el.rouletteResult.textContent = lethal
            ? `BANG. ${data.rouletteTarget.name} is out.`
            : `CLICK. ${data.rouletteTarget.name} lives.`;
        el.rouletteResult.className = `roulette-result is-shown ${lethal ? 'is-bang' : 'is-click'}`;
        el.continueBtn.disabled = false;
        addLog(data.rouletteOutcomeText, lethal ? 'error' : 'success');
    });
}

export function cancelRoulette() {
    clearTimers();
}
