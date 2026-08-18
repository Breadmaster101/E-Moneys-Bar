/**
 * Shared mutable state.
 *
 * These are exported as *objects that get mutated in place* rather than
 * reassigned, so every module keeps a live view without import cycles.
 */

import { HAND_SIZE, REVOLVER_CHAMBERS, DEFAULT_TURN_SECONDS, PLAYER_COLORS } from './constants.js';

/** Who I am. */
export const localPlayer = {
    id: null,
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
    /** host only: playerId -> counters for the ledger. Never broadcast as state. */
    stats: {},
    roundsPlayed: 0,
    eliminatedCount: 0,
};

/** Connection + transient UI bookkeeping. */
export const session = {
    socket: null,
    roomCode: null,
    /** host only: { socketId: true } for every connected client */
    hostConnections: {},
    /** cards the player has tapped, in tap order */
    selected: [],
    /** client only: previous state, used to diff for log messages */
    lastSeenState: {},
};

export function resetLocalPlayer(name = '') {
    Object.assign(localPlayer, {
        id: session.socket?.id ?? null,
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
