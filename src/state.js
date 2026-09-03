/**
 * Shared mutable state.
 *
 * These are exported as *objects that get mutated in place* rather than
 * reassigned, so every module keeps a live view without import cycles.
 */

import { HAND_SIZE, REVOLVER_CHAMBERS, DEFAULT_TURN_SECONDS, PLAYER_COLORS } from './constants.js';

/* ------------------------------------------------------------------ */
/* identity                                                            */
/* ------------------------------------------------------------------ */

const KEY_STORE = 'emb.key';

/**
 * A player id that outlives the socket.
 *
 * This used to be `socket.id`, and that was the single largest source of
 * multiplayer breakage. A socket that drops and reconnects — which on a phone
 * is every time the screen locks — comes back with a *different* id, so the
 * host saw a stranger where a player used to be: it seated them a second time,
 * eliminated the original, and there was no way back to the seat that still
 * held your hand.
 *
 * So identity is ours and the socket id is just an address. This is per-tab
 * (sessionStorage, not local) so two tabs on one machine are two players, and
 * it survives a reload of that tab, which is what makes refreshing out of a
 * wedged page a recovery rather than a forfeit.
 */
function stablePlayerKey() {
    try {
        const existing = sessionStorage.getItem(KEY_STORE);
        if (existing) return existing;
        const minted = `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
        sessionStorage.setItem(KEY_STORE, minted);
        return minted;
    } catch {
        // private mode with storage walled off: a per-load key still works for
        // everything except surviving a reload, which is the lesser loss
        return `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    }
}

/** Stable for the life of this tab. Every `player.id` in the game is one of these. */
export const MY_KEY = stablePlayerKey();

/** Who I am. */
export const localPlayer = {
    id: MY_KEY,
    name: '',
    isHost: false,
    hand: [],
    eliminated: false,
    revolverDeck: [],
    revolverChambersLeft: REVOLVER_CHAMBERS,
    cardCount: 0,
    readyForRematch: false,
};

/** The shared game. On the host this is authoritative; on clients it's a mirror. */
export const gameState = {
    players: [],
    liarsDeck: [],
    tableDeck: [],
    centerPile: [],
    currentPlayerId: null,
    currentTableSuit: null,
    lastPlayedTurn: null,
    gamePhase: 'lobby',
    centerPileCardCount: 0,
    rematchReadyStatus: {},
    lastChallengeRouletteTargetId: null,
    config: { handSize: HAND_SIZE, turnSeconds: DEFAULT_TURN_SECONDS },
    /** ms remaining on the current turn at the moment this state was sent. */
    turnRemainingMs: 0,
    /**
     * Bumped by the host on every broadcast. It rides on the heartbeat too, so
     * a client that quietly missed an update notices within one beat and asks
     * for a resync instead of rendering a board that stopped being true.
     */
    stateVersion: 0,
    turnEpoch: 0,
    /** host only: playerId -> counters for the ledger. Never broadcast as state. */
    stats: {},
    roundsPlayed: 0,
    eliminatedCount: 0,
};

/** Connection + transient UI bookkeeping. */
export const session = {
    socket: null,
    roomCode: null,
    /** this tab's current socket address. Changes on every reconnect; never an identity. */
    socketId: null,
    /**
     * host only: playerKey -> { socketId, lastSeen, away }.
     *
     * Keyed by the stable player key rather than the socket, so a reconnecting
     * player updates their address in place instead of arriving as a stranger.
     */
    hostConnections: {},
    /** client only: true once the host has answered our handshake. */
    seated: false,
    /** client only: when the host was last heard from, for the silence timeout. */
    lastHostBeat: 0,
    /** actions written while the socket was down, flushed on reconnect. */
    outbox: [],
    /** cards the player has tapped, in tap order */
    selected: [],
    /** client only: previous state, used to diff for log messages */
    lastSeenState: {},
};

export function resetLocalPlayer(name = '') {
    Object.assign(localPlayer, {
        id: MY_KEY,
        name,
        isHost: false,
        hand: [],
        eliminated: false,
        revolverDeck: [],
        revolverChambersLeft: REVOLVER_CHAMBERS,
        cardCount: 0,
        readyForRematch: false,
    });
}

export function resetGameState() {
    Object.assign(gameState, {
        players: [],
        liarsDeck: [],
        tableDeck: [],
        centerPile: [],
        currentPlayerId: null,
        currentTableSuit: null,
        lastPlayedTurn: null,
        gamePhase: 'lobby',
        centerPileCardCount: 0,
        rematchReadyStatus: {},
        lastChallengeRouletteTargetId: null,
        turnRemainingMs: 0,
        stateVersion: 0,
        turnEpoch: 0,
        stats: {},
        roundsPlayed: 0,
        eliminatedCount: 0,
    });
    gameState.config = { handSize: HAND_SIZE, turnSeconds: gameState.config.turnSeconds };
}

export function resetSession({ keepSocket = true } = {}) {
    if (!keepSocket) session.socket = null;
    session.roomCode = null;
    session.hostConnections = {};
    session.seated = false;
    session.lastHostBeat = 0;
    session.outbox = [];
    session.selected = [];
    session.lastSeenState = {};
}

/** Stable accent colour for a player, based on their seat index. */
export function colorFor(playerId) {
    const idx = gameState.players.findIndex((p) => p.id === playerId);
    return PLAYER_COLORS[(idx < 0 ? 0 : idx) % PLAYER_COLORS.length];
}

/** Two-letter monogram for avatars. */
export function initialsFor(name = '') {
    const parts = name.trim().split(/[\s_-]+/).filter(Boolean);
    if (parts.length === 0) return '??';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const isMyTurn = () =>
    gameState.currentPlayerId === localPlayer.id && gameState.gamePhase === 'playing';

export const amEliminated = () =>
    gameState.players.find((p) => p.id === localPlayer.id)?.eliminated ?? false;
