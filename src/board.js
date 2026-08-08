/**
 * board.js — the table centre, the turn indicator, and the action bar.
 */

import { el } from './dom.js';
import { SUIT_SYMBOLS, SUIT_NAMES, SUIT_IS_RED, MAX_CARDS_PER_PLAY } from './constants.js';
import { gameState, localPlayer, session, colorFor, initialsFor, isMyTurn, amEliminated } from './state.js';
import { createCard } from './cards.js';
import { renderSeats, renderSelfPlate } from './seats.js';
import { renderHand } from './hand.js';
import { sfx } from './audio.js';

const MAX_PILE_VISUALS = 8;

let lastSuit = null;
let lastPileCount = 0;
let announcedTurnFor = null;

/* ------------------------------------------------------------------ */
/* table centre                                                        */
/* ------------------------------------------------------------------ */

function updateSuitMedallion() {
    const suit = gameState.currentTableSuit;

    if (!suit) {
        el.suitGlyph.textContent = '?';
        el.suitName.textContent = '—';
        el.suitMedallion.removeAttribute('data-color');
        lastSuit = null;
        return;
    }

    el.suitGlyph.textContent = SUIT_SYMBOLS[suit];
    el.suitName.textContent = SUIT_NAMES[suit];
    el.suitMedallion.dataset.color = SUIT_IS_RED[suit] ? 'red' : 'black';

    if (suit !== lastSuit) {
        lastSuit = suit;
        el.suitMedallion.classList.remove('is-new');
        void el.suitMedallion.offsetWidth;
        el.suitMedallion.classList.add('is-new');
    }
}

function updatePile() {
    const count = gameState.centerPileCardCount ?? 0;
    if (count === lastPileCount && el.pile.children.length) return;

    const previous = lastPileCount;
    lastPileCount = count;
    el.pile.innerHTML = '';

    const visible = Math.min(count, MAX_PILE_VISUALS);
    for (let i = 0; i < visible; i++) {
        const card = createCard(null, { faceUp: false, size: 'mini' });
        const rot = (Math.random() - 0.5) * 26;
        const dx = (Math.random() - 0.5) * 12;
        const dy = (Math.random() - 0.5) * 10 - i * 1.2;
        card.style.setProperty('--pile-rot', `${rot}deg`);
        card.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
        card.style.zIndex = String(i);
        // only the genuinely new cards get the drop-in
        if (count > previous && i < visible - (count - previous)) card.style.animation = 'none';
        el.pile.appendChild(card);
    }

    if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'pile__count';
        badge.textContent = count === 1 ? '1 card down' : `${count} cards down`;
        el.pile.appendChild(badge);
    }
}

function updateLastPlay() {
    const turn = gameState.lastPlayedTurn;

    if (turn) {
        const n = turn.cardsPlayedCount ?? 0;
        const sym = SUIT_SYMBOLS[turn.declaredSuit] ?? turn.declaredSuit;
        el.lastPlay.innerHTML = '';
        el.lastPlay.append(
            Object.assign(document.createElement('b'), { textContent: turn.playerName }),
            document.createTextNode(` claimed ${n} × ${sym}`),
        );
    } else if (gameState.gamePhase === 'playing') {
        el.lastPlay.textContent = 'Awaiting the first play…';
    } else {
        el.lastPlay.textContent = '—';
    }
}

/* ------------------------------------------------------------------ */
/* turn indicator                                                      */
/* ------------------------------------------------------------------ */

export function updateTurnPill() {
    const current = gameState.players.find((p) => p.id === gameState.currentPlayerId);
    const mine = isMyTurn() && !amEliminated();

    el.turnPill.classList.toggle('is-mine', mine);
    el.dock.classList.toggle('is-my-turn', mine);

    if (!current || gameState.gamePhase !== 'playing') {
        el.turnPillAvatar.textContent = '';
        el.turnPillAvatar.style.opacity = '0';
        el.turnPillText.textContent =
            gameState.gamePhase === 'game_over' ? 'Game over' : 'Standing by…';
        return;
    }

    el.turnPillAvatar.style.opacity = '1';
    el.turnPillAvatar.textContent = initialsFor(current.name);
    el.turnPillAvatar.style.setProperty('--seat-color', colorFor(current.id));
    el.turnPillText.textContent = mine ? 'Your turn' : `${current.name}'s turn`;
}

/** Big centre-screen callout. */
export function announce(text, { danger = false } = {}) {
    el.turnAnnounce.querySelector('.turn-announce__text').textContent = text;
    el.turnAnnounce.classList.toggle('turn-announce--danger', danger);
    el.turnAnnounce.classList.remove('is-shown');
    void el.turnAnnounce.offsetWidth;
    el.turnAnnounce.classList.add('is-shown');
}

/** Fire "YOUR TURN" exactly once per turn hand-off. */
function maybeAnnounceTurn() {
    const key = `${gameState.currentPlayerId}:${gameState.centerPileCardCount}:${gameState.currentTableSuit}`;
    if (gameState.gamePhase !== 'playing') {
        announcedTurnFor = null;
        return;
    }
    if (!isMyTurn() || amEliminated()) return;
    if (announcedTurnFor === key) return;
    announcedTurnFor = key;

    const mustChallenge = localPlayer.hand.length === 0 && gameState.lastPlayedTurn;
    announce(mustChallenge ? 'Call it' : 'Your turn', { danger: !!mustChallenge });
    sfx.turnAlert();
}

/* ------------------------------------------------------------------ */
/* action bar                                                          */
/* ------------------------------------------------------------------ */

export function updateActions() {
    const mine = isMyTurn() && !amEliminated();
    if (!mine) session.selected = [];

    const n = session.selected.length;

    el.playBtn.disabled = !mine || n === 0 || localPlayer.hand.length === 0;
    el.playBtn.querySelector('.btn__label').textContent = n > 0 ? `Play ${n}` : 'Play';

    el.liarBtn.disabled = !mine || !gameState.lastPlayedTurn;

    el.selectCounter.querySelector('b').textContent = String(n);
    el.selectCounter.classList.toggle('is-active', n > 0 && n < MAX_CARDS_PER_PLAY);
    el.selectCounter.classList.toggle('is-full', n === MAX_CARDS_PER_PLAY);
}

/* ------------------------------------------------------------------ */
/* aggregate                                                           */
/* ------------------------------------------------------------------ */

export function updateBoard({ dealt = false } = {}) {
    if (gameState.gamePhase === 'lobby') return;

    renderSeats();
    renderSelfPlate();
    renderHand({ animateDeal: dealt });
    updateSuitMedallion();
    updatePile();
    updateLastPlay();
    updateTurnPill();
    updateActions();
    maybeAnnounceTurn();
}

/** Wipe per-round render memory (new game / leaving the table). */
export function resetBoardMemory() {
    lastSuit = null;
    lastPileCount = 0;
    announcedTurnFor = null;
    el.pile.innerHTML = '';
    el.seats.innerHTML = '';
    el.hand.innerHTML = '';
}
