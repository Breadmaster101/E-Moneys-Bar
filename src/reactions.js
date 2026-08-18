/**
 * reactions.js: the only thing players can say to each other.
 *
 * There is no chat, and adding one would change what the game is: half of a
 * bluffing game is the silence. So this is a fixed set of six marks, struck in
 * the same line as everything else, floated over the seat that sent it.
 *
 * Eliminated players keep the tray. Being shot takes you out of the hand, not
 * out of the room, and a table where the dead can still heckle is a better
 * table than one where they close the tab.
 */

import { el } from './dom.js';
import { gameState, localPlayer, colorFor } from './state.js';
import { icon } from './icons.js';
import { sfx } from './audio.js';

/**
 * The vocabulary. Order is the order they appear in the tray and the number
 * key that sends them, so inserting one renumbers everything after it.
 */
export const REACTIONS = [
    { id: 'cheers', label: 'Cheers' },
    { id: 'watch', label: 'Watching you' },
    { id: 'mask', label: 'You had me' },
    { id: 'skull', label: "You're done" },
    { id: 'hat', label: 'Well played' },
    { id: 'hourglass', label: 'Any day now' },
];

const IDS = new Set(REACTIONS.map((r) => r.id));
export const isReaction = (mark) => IDS.has(mark);

/**
 * Long enough that nobody can hold the bell down, short enough that a quick
 * exchange still reads as an exchange. Enforced twice: here so the tray shows
 * you it is spent, and on the host so that means something.
 */
export const REACTION_COOLDOWN_MS = 1400;

/** How long a mark stays on screen. */
const FLOAT_MS = 1900;

/** Marks on screen at once, oldest dropped first. */
const MAX_ON_SCREEN = 10;

let lastSentAt = 0;
let cooldownTimer = null;
let send = () => { };

/* ------------------------------------------------------------------ */
/* the tray                                                            */
/* ------------------------------------------------------------------ */

function buildTray() {
    el.reactionTray.innerHTML = '';

    REACTIONS.forEach((mark, i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rx-btn';
        btn.dataset.mark = mark.id;
        btn.setAttribute('role', 'menuitem');
        btn.title = `${mark.label} (${i + 1})`;
        btn.setAttribute('aria-label', mark.label);

        const key = document.createElement('kbd');
        key.textContent = String(i + 1);

        const label = document.createElement('span');
        label.className = 'rx-btn__label';
        label.textContent = mark.label;

        btn.append(icon(`rx-${mark.id}`), label, key);
        el.reactionTray.appendChild(btn);
    });
}

export function isTrayOpen() {
    return !el.reactionTray.hidden;
}

export function openTray(open = true) {
    el.reactionTray.hidden = !open;
    el.reactionBtn.setAttribute('aria-expanded', String(open));
    el.reactionBtn.classList.toggle('is-open', open);
}

export function toggleTray() {
    openTray(!isTrayOpen());
}

/** Grey the bell out for as long as the cooldown has left to run. */
function paintCooldown() {
    const spent = Date.now() - lastSentAt < REACTION_COOLDOWN_MS;
    el.reactionWrap.classList.toggle('is-spent', spent);

    clearTimeout(cooldownTimer);
    if (spent) {
        cooldownTimer = setTimeout(paintCooldown, REACTION_COOLDOWN_MS - (Date.now() - lastSentAt) + 20);
    }
}

/* ------------------------------------------------------------------ */
/* sending                                                             */
/* ------------------------------------------------------------------ */

/**
 * Wire up the transport. Passed in from main.js rather than imported, because
 * net.js already imports this module to show what it receives and the cycle
 * would be a real one: this runs at module scope, not from a hoisted function.
 *
 * @param {(mark: string) => void} fn
 */
export function setReactionSender(fn) {
    send = fn;
}

export function sendReaction(markId) {
    if (!isReaction(markId)) return;
    if (!gameState.players.some((p) => p.id === localPlayer.id)) return;
    if (Date.now() - lastSentAt < REACTION_COOLDOWN_MS) return;

    lastSentAt = Date.now();
    paintCooldown();
    openTray(false);

    /*
     * Drawn here and now rather than waiting for it to come back off the relay.
     * The host's broadcast reaches the room the sender is also in, so the echo
     * would otherwise draw the mark a second time; `showReaction` drops
     * anything addressed to us for exactly that reason.
     */
    showReaction(localPlayer.id, markId, { local: true });
    send(markId);
}

/* ------------------------------------------------------------------ */
/* showing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Where a player's mark should appear. Deliberately not `seatNodeFor()`: that
 * answers with the mini-fan, which is the right anchor for a card flying out of
 * a hand and the wrong one for something meant to be read as coming from a
 * person.
 */
function anchorFor(playerId) {
    if (playerId === localPlayer.id) {
        return el.selfPlate.hidden ? el.dock : el.selfPlate;
    }
    const seat = el.seats.querySelector(`.seat[data-player-id="${playerId}"]`);
    return seat?.querySelector('.seat__avatar') ?? seat;
}

/**
 * @param {string} playerId who sent it
 * @param {string} markId   one of REACTIONS
 * @param {object} [opts]
 * @param {boolean} [opts.local] true when this is our own, drawn on send
 */
export function showReaction(playerId, markId, { local = false } = {}) {
    if (!isReaction(markId)) return;
    // our own comes back off the relay; it was already drawn on the way out
    if (!local && playerId === localPlayer.id) return;

    sfx.reaction(markId);

    const anchor = anchorFor(playerId);
    if (!anchor || !el.reactionLayer) return;

    const box = anchor.getBoundingClientRect();
    if (!box.width && !box.height) return;

    const node = document.createElement('div');
    node.className = 'rx-mark';
    node.style.left = `${box.left + box.width / 2}px`;
    node.style.top = `${box.top}px`;
    node.style.setProperty('--seat-color', colorFor(playerId));

    node.appendChild(icon(`rx-${markId}`));
    el.reactionLayer.appendChild(node);

    while (el.reactionLayer.children.length > MAX_ON_SCREEN) {
        el.reactionLayer.firstElementChild.remove();
    }

    // a timeout rather than `animationend`: CSS animations are suspended in a
    // background tab, and a mark whose only exit is its own animation would
    // still be sitting there when the player came back
    setTimeout(() => node.remove(), FLOAT_MS);
}

/** Clear the layer (leaving a table, starting a game). */
export function clearReactions() {
    if (el.reactionLayer) el.reactionLayer.innerHTML = '';
    openTray(false);
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */

export function initReactions() {
    buildTray();

    el.reactionBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleTray();
        sfx.tap();
    });

    el.reactionTray.addEventListener('click', (event) => {
        const btn = event.target.closest('.rx-btn');
        if (btn) sendReaction(btn.dataset.mark);
    });

    // anywhere else on the page closes it, the same as any other menu
    document.addEventListener('click', (event) => {
        if (isTrayOpen() && !el.reactionWrap.contains(event.target)) openTray(false);
    });
}
