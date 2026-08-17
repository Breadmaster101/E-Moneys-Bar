/**
 * cards.js: how a playing card looks, and how it flies across the table.
 * Gradients and the card-back pattern live once in #svg-defs (index.html).
 */

import { SUIT_SYMBOLS, SUIT_IS_RED } from './constants.js';
import { reducedMotion } from './motion.js';

const VB = '0 0 64 96';

function faceMarkup(rank, suit) {
    const color = SUIT_IS_RED[suit] ? 'var(--suit-red)' : 'var(--suit-black)';
    const sym = SUIT_SYMBOLS[suit] ?? suit;
    const wide = rank === '10' ? ' card__rank--wide' : '';
    const corner = `
        <text class="card__rank${wide}" x="7" y="20" fill="${color}">${rank}</text>
        <text class="card__pip-sm" x="8.5" y="33" fill="${color}">${sym}</text>`;

    return `<svg viewBox="${VB}" aria-hidden="true">
        <rect x="1" y="1" width="62" height="94" rx="5" fill="url(#grad-card-face)"
              stroke="var(--card-edge)" stroke-width="1"/>
        <rect x="4.5" y="4.5" width="55" height="87" rx="3" fill="none"
              stroke="rgba(0,0,0,.07)" stroke-width="1"/>
        ${corner}
        <text class="card__pip-lg" x="32" y="50" text-anchor="middle" dominant-baseline="central"
              fill="${color}" opacity=".92">${sym}</text>
        <g transform="rotate(180 32 48)">${corner}</g>
        <rect x="1" y="1" width="62" height="94" rx="5" fill="url(#grad-card-gloss)" opacity=".45"/>
    </svg>`;
}

function backMarkup() {
    return `<svg viewBox="${VB}" aria-hidden="true">
        <rect x="1" y="1" width="62" height="94" rx="5" fill="url(#grad-card-back)"
              stroke="#170409" stroke-width="1"/>
        <rect x="5" y="5" width="54" height="86" rx="3" fill="url(#pat-card-back)" opacity=".85"/>
        <rect x="5" y="5" width="54" height="86" rx="3" fill="none"
              stroke="#d99a44" stroke-opacity=".45" stroke-width="1"/>
        <circle cx="32" cy="48" r="13.5" fill="#22060d" stroke="#d99a44" stroke-opacity=".55"/>
        <text class="card__monogram" x="32" y="49" text-anchor="middle" dominant-baseline="central"
              fill="#d99a44">E</text>
        <rect x="1" y="1" width="62" height="94" rx="5" fill="url(#grad-card-gloss)" opacity=".22"/>
    </svg>`;
}

/**
 * @param {object} card  {rank, suit, id}. Pass null for a face-down card.
 * @param {object} opts  {faceUp, size: 'full'|'sm'|'mini', className}
 */
export function createCard(card, { faceUp = true, size = 'full', className = '' } = {}) {
    const node = document.createElement('div');
    node.className = ['card', size !== 'full' ? `card--${size}` : '', className]
        .filter(Boolean)
        .join(' ');
    node.innerHTML = faceUp && card ? faceMarkup(card.rank, card.suit) : backMarkup();
    if (card?.id) node.dataset.cardId = card.id;
    return node;
}

/**
 * Throw `count` face-down cards from one element to another.
 * Purely cosmetic: the real state has already moved.
 */
export function flyCards(fromNode, toNode, count = 1) {
    if (!fromNode || !toNode || count < 1) return;
    if (reducedMotion()) return;

    const from = fromNode.getBoundingClientRect();
    const to = toNode.getBoundingClientRect();
    if (!from.width || !to.width) return;

    for (let i = 0; i < Math.min(count, 3); i++) {
        const ghost = createCard(null, { faceUp: false, size: 'mini', className: 'card-flight' });
        const w = to.width || 34;
        const h = to.height || 51;

        ghost.style.width = `${w}px`;
        ghost.style.height = `${h}px`;
        ghost.style.left = `${from.left + from.width / 2 - w / 2}px`;
        ghost.style.top = `${from.top + from.height / 2 - h / 2}px`;
        ghost.style.transform = 'scale(1.35) rotate(0deg)';
        ghost.style.transitionDelay = `${i * 70}ms`;
        document.body.appendChild(ghost);

        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        const spin = (Math.random() - 0.5) * 40;

        setTimeout(() => {
            ghost.style.transform = `translate(${dx}px, ${dy}px) scale(1) rotate(${spin}deg)`;
            ghost.style.opacity = '0';
        }, 16);

        setTimeout(() => ghost.remove(), 1000 + i * 70);
    }
}

/** Sort a hand: suits grouped, ranks ascending. */
export function sortHand(hand, suitOrder = ['H', 'D', 'C', 'S'], ranks = []) {
    return [...hand].sort((a, b) => {
        const s = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
        return s !== 0 ? s : ranks.indexOf(a.rank) - ranks.indexOf(b.rank);
    });
}
