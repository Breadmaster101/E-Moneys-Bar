/**
 * hand.js: your own cards: the fan, the picking, the throwing.
 */

import { el } from './dom.js';
import { RANKS, MAX_CARDS_PER_PLAY } from './constants.js';
import { localPlayer, session, isMyTurn, amEliminated } from './state.js';
import { createCard, sortHand } from './cards.js';
import { sfx } from './audio.js';
import { toast } from './toast.js';
import { updateActions } from './board.js';

/** ids currently rendered, so we can skip pointless rebuilds */
let renderedIds = '';

function fanGeometry(n) {
    if (n <= 1) return { step: 0, curve: 0, overlap: -10 };
    const step = Math.min(52 / n, 7.5); // degrees between neighbours
    const curve = Math.min(2.2, 11 / n); // px of arc drop per unit offset²
    const overlap = n > 7 ? -34 : n > 5 ? -26 : -16;
    return { step, curve, overlap };
}

/**
 * How much room the fan may occupy: the dock's width, minus a symmetric gutter
 * wide enough for the self plate parked at the left edge (so it stays centred).
 */
function availableFanWidth() {
    const wrap = el.hand.parentElement;
    if (!wrap) return Infinity;
    const pad = getComputedStyle(wrap);
    const inner = wrap.clientWidth - parseFloat(pad.paddingLeft) - parseFloat(pad.paddingRight);
    const gutter = el.selfPlate.hidden ? 0 : el.selfPlate.offsetWidth + 18;
    return inner - gutter * 2;
}

function applyFan() {
    const cards = Array.from(el.hand.children);
    const n = cards.length;
    let { step, curve, overlap } = fanGeometry(n);

    // tighten the fan if the nominal overlap would run it into the self plate.
    // offsetWidth, not getBoundingClientRect(): the latter includes the fan's
    // own rotation, which would over-report the card width by ~40%.
    const cardW = cards[0]?.offsetWidth ?? 0;
    const available = availableFanWidth();
    if (n > 1 && cardW > 0 && Number.isFinite(available)) {
        const maxOverlap = (available - n * cardW) / n;
        overlap = Math.max(Math.min(overlap, maxOverlap), -cardW * 0.62);
    }

    el.hand.style.setProperty('--card-overlap', `${overlap}px`);

    cards.forEach((card, i) => {
        const offset = i - (n - 1) / 2;
        card.style.setProperty('--rot', `${offset * step}deg`);
        card.style.setProperty('--lift', `${offset * offset * curve}px`);
        card.style.zIndex = String(i);
    });
}

function paintSelection() {
    Array.from(el.hand.children).forEach((card) => {
        const order = session.selected.findIndex((c) => c.id === card.dataset.cardId);
        card.classList.toggle('is-selected', order > -1);

        let chip = card.querySelector('.card__order');
        if (order > -1) {
            if (!chip) {
                chip = document.createElement('span');
                chip.className = 'card__order';
                card.appendChild(chip);
            }
            chip.textContent = String(order + 1);
        } else if (chip) {
            chip.remove();
        }
    });
}

export function renderHand({ animateDeal = false } = {}) {
    const cards = sortHand(localPlayer.hand ?? [], ['H', 'D', 'C', 'S'], RANKS);
    const ids = cards.map((c) => c.id).join(',');

    if (ids !== renderedIds) {
        renderedIds = ids;
        el.hand.innerHTML = '';
        cards.forEach((card, i) => {
            const node = createCard(card);
            node.style.setProperty('--deal-delay', animateDeal ? `${i * 65}ms` : '0ms');
            node.addEventListener('click', () => onCardClick(card.id));
            el.hand.appendChild(node);
        });
    }

    // always: the fan depends on the viewport, not just on which cards you hold
    applyFan();
    el.hand.classList.toggle('is-live', isMyTurn() && !amEliminated());
    paintSelection();
}

function onCardClick(cardId) {
    if (!isMyTurn() || amEliminated()) {
        toast("Not your turn yet.", { type: 'warn', duration: 1800 });
        return;
    }

    const idx = session.selected.findIndex((c) => c.id === cardId);
    if (idx > -1) {
        session.selected.splice(idx, 1);
        sfx.cardDeselect();
    } else if (session.selected.length >= MAX_CARDS_PER_PLAY) {
        toast(`You can play at most ${MAX_CARDS_PER_PLAY} cards.`, { type: 'warn', duration: 2000 });
        return;
    } else {
        const card = localPlayer.hand.find((c) => c.id === cardId);
        if (!card) return;
        session.selected.push(card);
        sfx.cardSelect();
    }

    paintSelection();
    updateActions();
}

export function clearSelection() {
    session.selected = [];
    paintSelection();
}

/** Force the next renderHand() to rebuild from scratch. */
export function invalidateHand() {
    renderedIds = '';
}

/** Animate the selected cards out before the state update lands. */
export function animateSelectedOut() {
    Array.from(el.hand.children)
        .filter((card) => card.classList.contains('is-selected'))
        .forEach((card) => card.classList.add('is-leaving'));
}
