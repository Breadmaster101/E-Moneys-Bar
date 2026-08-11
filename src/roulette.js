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
}

function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
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
    el.revolverStage.classList.remove('is-firing');

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

    const flashWrap = document.createElement('div');
    flashWrap.className = 'revolver-flash';
    flashWrap.appendChild(Object.assign(document.createElement('div'), { className: 'revolver-flash__core' }));

    el.revolverStage.append(svg, flashWrap);
    return { svg, cylinder, mark, rounds, strikes, flashWrap };
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
    const { svg, cylinder, mark, rounds, strikes, flashWrap } = buildRevolver(plan.spentCount);

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
         * The shot comes out of the chamber under the mark, not the middle of
         * the cylinder.
         *
         * That chamber is always at the same place on the plate, whichever one
         * it is: the mark is at twelve o'clock and the cylinder turns beneath
         * it, so in viewBox terms the shot is always (100, 62), the centre
         * (100, 108) less the 46 chamber radius. Do NOT get this from the
         * chamber element's own getBoundingClientRect: that reports where the
         * chamber was drawn, and only picks up the rotation once the transform
         * has actually been committed, so it hands back the pre-spin position
         * and the flash goes off over the wrong hole.
         *
         * getScreenCTM does the viewBox-to-screen mapping including the
         * preserveAspectRatio letterboxing, so this survives any stage size.
         */
        const shot = new DOMPoint(100, 62).matrixTransform(svg.getScreenCTM());
        const shotX = shot.x;
        const shotY = shot.y;

        const stage = el.revolverStage.getBoundingClientRect();
        const core = flashWrap.querySelector('.revolver-flash__core');
        core.style.left = `${shotX - stage.left}px`;
        core.style.top = `${shotY - stage.top}px`;

        if (lethal) {
            el.revolverStage.classList.add('is-firing');
            flashWrap.classList.add('is-on');
            sfx.gunshot();
            fx.flash('#ffdca8', 0.85, 260);
            fx.shake(targetIsMe ? 26 : 16);
            fx.muzzleFlash(shotX, shotY);
            after(300, () => fx.flash('#ff2f4e', 0.22, 700));
            after(180, () => sfx.eliminate());
        } else {
            sfx.dryFire();
            fx.shake(5);
            fx.smokePuff(shotX, shotY);
        }

        /*
         * That round is gone, whichever way it went. Spending it here rather
         * than drawing the cylinder post-shot is what ties the picture to the
         * rules: the chamber you were just looking at is now one of the struck
         * ones, and next time round there is one fewer.
         */
        rounds[plan.landingChamber]?.classList.add('is-spent');
        strikes[plan.landingChamber]?.classList.add('is-shown');
        mark.classList.remove('is-striking');
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
