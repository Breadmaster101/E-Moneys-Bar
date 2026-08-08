/**
 * roulette.js: the game's big moment, as a real spinning cylinder.
 *
 * Timeline (ms):
 *    0   modal opens, cards flip up
 *  250   hammer cocks
 *  400   cylinder spins (2.1s, easing to a stop)
 * 2600   hammer falls
 * 2750   bang / click
 * 3000   result text, Continue enabled
 */

import { el, openModal } from './dom.js';
import { REVOLVER_CHAMBERS, SUIT_SYMBOLS } from './constants.js';
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
}

function svgEl(tag, attrs) {
    const node = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
}

/* ------------------------------------------------------------------ */
/* the revolver                                                        */
/* ------------------------------------------------------------------ */

function buildRevolver(spentIndices) {
    el.revolverStage.innerHTML = '';
    el.revolverStage.classList.remove('is-firing');

    const svg = svgEl('svg', { class: 'revolver-svg', viewBox: '0 0 200 200' });

    // hammer, sitting above the cylinder
    const hammer = svgEl('g', { class: 'revolver-hammer' });
    hammer.appendChild(svgEl('path', {
        d: 'M92 4 L108 4 L112 34 L100 44 L88 34 Z',
        fill: 'url(#grad-cyl-metal)', stroke: 'rgba(201,169,97,.62)', 'stroke-width': '1.5',
    }));
    hammer.appendChild(svgEl('rect', {
        x: '96', y: '32', width: '8', height: '16',
        fill: '#c9a961', stroke: '#8a6f34', 'stroke-width': '1',
    }));

    // frame. Colours here are the engraved palette from tokens.css: flat ink
    // fills with gold rules, matching the rest of the plate.
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

    for (let i = 0; i < REVOLVER_CHAMBERS; i++) {
        const angle = (-90 + i * 60) * (Math.PI / 180);
        const cx = 100 + Math.cos(angle) * 46;
        const cy = 108 + Math.sin(angle) * 46;
        const spent = spentIndices.has(i);

        cylinder.appendChild(svgEl('circle', {
            cx, cy, r: '18',
            fill: '#0a0908', stroke: 'rgba(201,169,97,.16)', 'stroke-width': '1',
        }));
        // a live round is inked solid; a spent one is an empty ruled circle
        cylinder.appendChild(svgEl('circle', {
            cx, cy, r: '14',
            fill: spent ? 'url(#grad-chamber-spent)' : 'url(#grad-chamber-live)',
            stroke: spent ? 'rgba(201,169,97,.34)' : '#8a6f34', 'stroke-width': '1.5',
        }));
        if (!spent) {
            cylinder.appendChild(svgEl('circle', {
                cx, cy, r: '5.5', fill: '#8a6f34',
            }));
        }
    }

    // centre pin
    cylinder.appendChild(svgEl('circle', {
        cx: '100', cy: '108', r: '11',
        fill: '#16130f', stroke: 'rgba(201,169,97,.34)', 'stroke-width': '1.5',
    }));

    svg.append(cylinder, hammer);

    const flashWrap = document.createElement('div');
    flashWrap.className = 'revolver-flash';
    flashWrap.appendChild(Object.assign(document.createElement('div'), { className: 'revolver-flash__core' }));

    el.revolverStage.append(svg, flashWrap);
    return { svg, cylinder, hammer, flashWrap };
}

/** Which chambers read as already-fired once the cylinder stops. */
function spentSet(chambersLeft, landingStep) {
    const firedIndex = (REVOLVER_CHAMBERS - landingStep) % REVOLVER_CHAMBERS;
    const spentCount = Math.max(1, REVOLVER_CHAMBERS - (chambersLeft ?? 0));
    const set = new Set();
    for (let j = 0; j < Math.min(spentCount, REVOLVER_CHAMBERS); j++) {
        set.add((firedIndex - j + REVOLVER_CHAMBERS) % REVOLVER_CHAMBERS);
    }
    return set;
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
    const landingStep = Math.floor(Math.random() * REVOLVER_CHAMBERS);
    const chambersLeft = targetAfter?.revolverChambersLeft ?? REVOLVER_CHAMBERS - 1;
    const { cylinder, hammer, flashWrap } = buildRevolver(spentSet(chambersLeft, landingStep));

    openModal(el.rouletteModal);

    if (!data.isCardDepletion) sfx.liar();

    after(250, () => {
        hammer.classList.add('is-cocked');
        sfx.hammerCock();
    });

    after(400, () => {
        const turns = 4 + Math.floor(Math.random() * 2);
        const end = `rotate(${turns * 360 + landingStep * 60}deg)`;
        /*
         * Driven by the Web Animations API rather than a CSS transition. A
         * transition needs the browser to have already computed the "before"
         * value in an earlier frame; when timers coalesce (a throttled or
         * just-restored tab) the set lands in the same frame as the insert and
         * the cylinder snaps to its final angle without ever spinning.
         * animate() states both ends explicitly, so it cannot mis-fire.
         */
        spin = cylinder.animate(
            [{ transform: 'rotate(0deg)' }, { transform: end }],
            { duration: 2100, easing: 'cubic-bezier(.16,.82,.18,1)', fill: 'forwards' },
        );
        sfx.revolverSpin(2.1);
    });

    after(2600, () => {
        hammer.classList.remove('is-cocked');
        hammer.classList.add('is-struck');
    });

    after(2740, () => {
        if (lethal) {
            el.revolverStage.classList.add('is-firing');
            flashWrap.classList.add('is-on');
            sfx.gunshot();
            fx.flash('#ffdca8', 0.85, 260);
            fx.shake(targetIsMe ? 26 : 16);
            const { x, y } = fx.centerOf(el.revolverStage);
            fx.muzzleFlash(x, y - 10);
            after(300, () => fx.flash('#ff2f4e', 0.22, 700));
            after(180, () => sfx.eliminate());
        } else {
            sfx.dryFire();
            fx.shake(5);
            const { x, y } = fx.centerOf(el.revolverStage);
            fx.smokePuff(x, y - 10);
        }
    });

    after(3000, () => {
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
