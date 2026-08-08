/**
 * seats.js — opponents around the table, plus your own status plate.
 */

import { el } from './dom.js';
import { REVOLVER_CHAMBERS, SEAT_LAYOUTS } from './constants.js';
import { gameState, localPlayer, colorFor, initialsFor } from './state.js';
import { createCard } from './cards.js';
import { icon } from './icons.js';

/** playerId -> was eliminated last render, so we can play the death beat once */
const wasEliminated = new Map();

function revolverNode(chambersLeft) {
    const wrap = document.createElement('div');
    wrap.className = 'revolver has-tip';
    wrap.dataset.tip = `${chambersLeft} of ${REVOLVER_CHAMBERS} chambers left`;

    for (let i = 0; i < REVOLVER_CHAMBERS; i++) {
        const dot = document.createElement('span');
        dot.className = `chamber ${i < chambersLeft ? 'is-loaded' : 'is-spent'}`;
        wrap.appendChild(dot);
    }

    const count = document.createElement('span');
    count.className = 'revolver__count';
    count.textContent = `${chambersLeft}/${REVOLVER_CHAMBERS}`;
    wrap.appendChild(count);

    return wrap;
}

function avatarNode(player) {
    const av = document.createElement('div');
    av.className = 'seat__avatar';
    av.style.setProperty('--seat-color', colorFor(player.id));
    av.textContent = initialsFor(player.name);
    if (player.isHost) {
        const mark = icon('star', 'ico--fill seat__host-mark');
        mark.setAttribute('title', 'Host');
        av.appendChild(mark);
    }
    return av;
}

function miniFan(count) {
    const wrap = document.createElement('div');
    wrap.className = `seat__cards${count === 0 ? ' seat__cards--empty' : ''}`;
    wrap.classList.add('has-tip');
    wrap.dataset.tip = count === 1 ? '1 card in hand' : `${count} cards in hand`;

    const step = count > 5 ? 7 : 11;
    const rotStep = count > 5 ? 3 : 5;

    for (let i = 0; i < count; i++) {
        const offset = i - (count - 1) / 2;
        const card = createCard(null, { faceUp: false, size: 'mini' });
        card.style.transform = `translateX(calc(-50% + ${offset * step}px)) rotate(${offset * rotStep}deg)`;
        card.style.zIndex = String(i);
        wrap.appendChild(card);
    }
    return wrap;
}

export function renderSeats() {
    const players = gameState.players;
    el.seats.innerHTML = '';
    if (players.length === 0) return;

    // rotate so that the seats read clockwise starting to your left
    const myIndex = players.findIndex((p) => p.id === localPlayer.id);
    const ordered = myIndex > -1 ? [...players.slice(myIndex), ...players.slice(0, myIndex)] : players;
    const opponents = ordered.filter((p) => p.id !== localPlayer.id);
    if (opponents.length === 0) return;

    const layout = SEAT_LAYOUTS[opponents.length] ?? SEAT_LAYOUTS[3];

    opponents.forEach((player, i) => {
        const slot = layout[i] ?? { x: 50, y: 20 };

        const seat = document.createElement('div');
        seat.className = 'seat';
        seat.dataset.playerId = player.id;
        seat.style.left = `${slot.x}%`;
        seat.style.top = `${slot.y}%`;
        seat.style.setProperty('--seat-color', colorFor(player.id));
        seat.style.setProperty('--seat-delay', `${i * 70}ms`);

        if (player.id === gameState.currentPlayerId && gameState.gamePhase === 'playing') {
            seat.classList.add('is-turn');
        }
        if (player.eliminated) {
            seat.classList.add('is-out');
            if (wasEliminated.get(player.id) === false) seat.classList.add('is-dying');
        }
        wasEliminated.set(player.id, !!player.eliminated);

        seat.appendChild(miniFan(player.eliminated ? 0 : player.cardCount ?? 0));

        const plate = document.createElement('div');
        plate.className = 'seat__plate';

        const meta = document.createElement('div');
        meta.className = 'seat__meta';
        const name = document.createElement('div');
        name.className = 'seat__name';
        name.textContent = player.name;
        meta.append(name, revolverNode(player.revolverChambersLeft ?? REVOLVER_CHAMBERS));

        plate.append(avatarNode(player), meta);
        seat.appendChild(plate);

        el.seats.appendChild(seat);
    });
}

export function renderSelfPlate() {
    const me = gameState.players.find((p) => p.id === localPlayer.id);
    const inPlay = ['playing', 'challenge_reveal', 'roulette', 'roulette_resolved'].includes(
        gameState.gamePhase,
    );

    if (!me || !inPlay) {
        el.selfPlate.hidden = true;
        return;
    }

    el.selfPlate.hidden = false;
    el.selfPlate.classList.toggle('is-turn', gameState.currentPlayerId === me.id);
    el.selfPlate.classList.toggle('is-out', !!me.eliminated);
    el.selfPlate.innerHTML = '';

    const meta = document.createElement('div');
    meta.className = 'seat__meta';

    const label = document.createElement('div');
    label.className = 'self-plate__label';
    label.textContent = me.eliminated ? 'Eliminated' : 'You';

    const revolver = revolverNode(me.revolverChambersLeft ?? REVOLVER_CHAMBERS);
    meta.append(label, revolver);

    el.selfPlate.append(avatarNode(me), meta);
}

/** Forget the elimination history (new game). */
export function resetSeatMemory() {
    wasEliminated.clear();
}

/** The on-screen node for a player, used as an animation anchor. */
export function seatNodeFor(playerId) {
    if (playerId === localPlayer.id) return el.hand.children.length ? el.hand : el.selfPlate;
    return el.seats.querySelector(`.seat[data-player-id="${playerId}"] .seat__cards`)
        ?? el.seats.querySelector(`.seat[data-player-id="${playerId}"]`);
}
