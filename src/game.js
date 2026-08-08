/**
 * game.js — host-authoritative game logic. Only the host ever runs any of this;
 * clients just render whatever gets broadcast back to them.
 */

import {
    SUITS, RANKS, SUIT_SYMBOLS, HAND_SIZE, MIN_PLAYERS, MAX_CARDS_PER_PLAY,
    REVOLVER_CHAMBERS, REVOLVER_BULLETS, ROULETTE_RESOLVE_MS,
} from './constants.js';
import { gameState, localPlayer, session } from './state.js';
import { sendMessage, activeConnectedIds } from './net.js';
import { addLog } from './log.js';
import { toast } from './toast.js';
import { armHostTimer, disarmHostTimer, hostRemainingMs } from './timer.js';
import {
    applyRouletteResults, showGameOver, updateRematchStatus, refreshBoard, showGameBoard,
    updateLobbySeats,
} from './ui.js';
import { flyCards } from './cards.js';
import { seatNodeFor, resetSeatMemory } from './seats.js';
import { el } from './dom.js';
import { sfx } from './audio.js';

/* ------------------------------------------------------------------ */
/* deck helpers                                                        */
/* ------------------------------------------------------------------ */

export const Deck = {
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    liars() {
        const deck = [];
        SUITS.forEach((suit) => RANKS.forEach((rank) => deck.push({ rank, suit, id: `${rank}${suit}` })));
        return this.shuffle(deck);
    },

    table() {
        return this.shuffle([...SUITS]);
    },

    revolver() {
        const deck = [];
        for (let i = 0; i < REVOLVER_CHAMBERS - REVOLVER_BULLETS; i++) deck.push('blank');
        for (let i = 0; i < REVOLVER_BULLETS; i++) deck.push('lethal');
        return this.shuffle(deck);
    },

    deal(players, deck, handSize) {
        players.forEach((player) => {
            player.hand = [];
            if (!player.eliminated) {
                for (let i = 0; i < handSize; i++) if (deck.length) player.hand.push(deck.pop());
            }
            player.cardCount = player.hand.length;
        });
    },

    /** true when every played card really was the table suit */
    isTruthful(cards, tableSuit) {
        return !cards?.length || cards.every((c) => c.suit === tableSuit);
    },
};

/* ------------------------------------------------------------------ */
/* broadcasting                                                        */
/* ------------------------------------------------------------------ */

export function broadcastState() {
    if (!localPlayer.isHost) return;

    const common = {
        players: gameState.players.map((p) => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            eliminated: p.eliminated,
            revolverChambersLeft: p.revolverChambersLeft,
            cardCount: p.cardCount,
        })),
        currentPlayerId: gameState.currentPlayerId,
        currentTableSuit: gameState.currentTableSuit,
        lastPlayedTurn: gameState.lastPlayedTurn
            ? {
                playerId: gameState.lastPlayedTurn.playerId,
                playerName: gameState.lastPlayedTurn.playerName,
                cardsPlayedCount: gameState.lastPlayedTurn.cardsPlayedCount,
                declaredSuit: gameState.lastPlayedTurn.declaredSuit,
            }
            : null,
        gamePhase: gameState.gamePhase,
        centerPileCardCount: gameState.centerPile.length,
        rematchReadyStatus: gameState.rematchReadyStatus,
        lastChallengeRouletteTargetId: gameState.lastChallengeRouletteTargetId,
        config: { ...gameState.config },
        turnEpoch: gameState.turnEpoch ?? 0,
        turnRemainingMs: hostRemainingMs(),
    };

    gameState.players.forEach((p) => {
        if (p.id !== localPlayer.id && session.hostConnections[p.id]) {
            sendMessage('GAME_STATE_UPDATE', { gameState: common, yourHand: p.hand }, p.id);
        }
    });

    const me = gameState.players.find((p) => p.id === localPlayer.id);
    if (me) Object.assign(localPlayer, me);

    refreshBoard();
}

/* ------------------------------------------------------------------ */
/* turn management                                                     */
/* ------------------------------------------------------------------ */

function setTurn(playerId) {
    gameState.currentPlayerId = playerId;
    gameState.turnEpoch = (gameState.turnEpoch ?? 0) + 1;
    armTurnTimer();
}

function armTurnTimer() {
    disarmHostTimer();
    const seconds = gameState.config.turnSeconds ?? 0;
    if (!seconds || gameState.gamePhase !== 'playing' || !gameState.currentPlayerId) return;
    armHostTimer(seconds, onTurnTimeout);
}

function onTurnTimeout() {
    if (!localPlayer.isHost || gameState.gamePhase !== 'playing') return;

    const player = gameState.players.find((p) => p.id === gameState.currentPlayerId);
    if (!player || player.eliminated) {
        advanceTurnFrom(gameState.currentPlayerId);
        broadcastState();
        return;
    }

    addLog(`${player.name} ran out of time.`, 'error');

    if (player.hand.length === 0) {
        // no cards left means their only legal move is a challenge
        if (gameState.lastPlayedTurn) handleCallLiar(player.id);
        else {
            advanceTurnFrom(player.id);
            broadcastState();
        }
        return;
    }

    const card = player.hand[Math.floor(Math.random() * player.hand.length)];
    handlePlayCards(player.id, [card.id], { auto: true });
}

function advanceTurnFrom(playerId) {
    const players = gameState.players;
    if (!players.length) return false;

    let idx = players.findIndex((p) => p.id === playerId);
    for (let attempts = 0; attempts < players.length; attempts++) {
        idx = (idx + 1) % players.length;
        if (!players[idx].eliminated) {
            setTurn(players[idx].id);
            return true;
        }
    }
    return false;
}

/* ------------------------------------------------------------------ */
/* game lifecycle                                                      */
/* ------------------------------------------------------------------ */

export function startNewGame() {
    if (!localPlayer.isHost) return;

    const previousIds = gameState.players.map((p) => p.id);
    const eligible = activeConnectedIds().filter((id) => previousIds.includes(id));

    let roster = gameState.players
        .filter((p) => eligible.includes(p.id))
        .map((p) => ({
            id: p.id,
            name: p.name,
            isHost: p.isHost,
            eliminated: false,
            hand: [],
            revolverDeck: Deck.revolver(),
            revolverChambersLeft: REVOLVER_CHAMBERS,
            cardCount: 0,
        }));

    if (!roster.some((p) => p.id === localPlayer.id)) {
        roster.unshift({
            id: localPlayer.id,
            name: localPlayer.name,
            isHost: true,
            eliminated: false,
            hand: [],
            revolverDeck: Deck.revolver(),
            revolverChambersLeft: REVOLVER_CHAMBERS,
            cardCount: 0,
        });
        roster = [...new Map(roster.map((p) => [p.id, p])).values()];
    }

    // seat everyone at random so the same person doesn't always lead
    Deck.shuffle(roster);
    gameState.players = roster;

    gameState.rematchReadyStatus = {};
    gameState.liarsDeck = Deck.liars();
    gameState.tableDeck = Deck.table();
    gameState.centerPile = [];
    gameState.centerPileCardCount = 0;
    gameState.lastPlayedTurn = null;
    gameState.currentPlayerId = null;
    gameState.lastChallengeRouletteTargetId = null;
    gameState.turnEpoch = 0;

    resetSeatMemory();
    startNewRound();
}

export function startNewRound() {
    if (!localPlayer.isHost) return;

    if (!gameState.tableDeck.length) gameState.tableDeck = Deck.table();
    gameState.currentTableSuit = gameState.tableDeck.pop();

    const active = gameState.players.filter((p) => !p.eliminated);
    if (!active.length) return;

    if (gameState.liarsDeck.length < active.length * HAND_SIZE) {
        gameState.liarsDeck = Deck.liars();
        addLog('Deck reshuffled.', 'system');
    }

    Deck.deal(gameState.players, gameState.liarsDeck, HAND_SIZE);
    gameState.centerPile = [];
    gameState.centerPileCardCount = 0;
    gameState.lastPlayedTurn = null;
    gameState.gamePhase = 'playing';

    addLog(
        `New round — table suit is ${SUIT_SYMBOLS[gameState.currentTableSuit]} ${gameState.currentTableSuit}.`,
        'system',
    );

    // whoever last faced the revolver opens the next round
    let starter = null;
    if (gameState.lastChallengeRouletteTargetId) {
        const candidate = gameState.players.find((p) => p.id === gameState.lastChallengeRouletteTargetId);
        if (candidate && !candidate.eliminated) {
            starter = candidate.id;
            addLog(`${candidate.name} opens the round.`, 'system');
        }
        gameState.lastChallengeRouletteTargetId = null;
    }
    if (!starter) {
        starter = active[Math.floor(Math.random() * active.length)].id;
        addLog(`${gameState.players.find((p) => p.id === starter).name} opens the round.`, 'system');
    }

    setTurn(starter);
    broadcastState();
}

/* ------------------------------------------------------------------ */
/* the revolver                                                        */
/* ------------------------------------------------------------------ */

function fireRevolver(targetPlayer) {
    const target = gameState.players.find((p) => p.id === targetPlayer.id);
    if (!target || target.eliminated) return null;

    if (!target.revolverDeck?.length) {
        target.revolverDeck = Deck.revolver();
        target.revolverChambersLeft = REVOLVER_CHAMBERS;
    }

    const fired = target.revolverDeck.pop();
    target.revolverChambersLeft = target.revolverDeck.length;

    let outcomeText;
    if (fired === 'lethal') {
        target.eliminated = true;
        target.cardCount = 0;
        outcomeText = `BANG! ${target.name} is eliminated.`;
    } else {
        outcomeText = `Click. ${target.name} survives.`;
        if (!target.revolverDeck.length) {
            target.revolverDeck = Deck.revolver();
            target.revolverChambersLeft = REVOLVER_CHAMBERS;
        }
    }

    gameState.lastChallengeRouletteTargetId = target.id;
    gameState.players.forEach((p) => { p.cardCount = p.eliminated ? 0 : p.hand.length; });

    return {
        rouletteTarget: { id: target.id, name: target.name },
        rouletteOutcome: fired,
        rouletteOutcomeText: outcomeText,
        updatedPlayersData: gameState.players.map((p) => ({
            id: p.id,
            name: p.name,
            eliminated: p.eliminated,
            revolverChambersLeft: p.revolverChambersLeft,
            cardCount: p.cardCount,
        })),
    };
}

/** Publish a roulette result and schedule whatever comes next. */
function resolveRoulette(results) {
    disarmHostTimer();
    sendMessage('CHALLENGE_ROULETTE_RESULTS', results);
    applyRouletteResults(results);

    gameState.gamePhase = 'roulette_resolved';
    broadcastState();

    setTimeout(() => {
        const survivors = gameState.players.filter((p) => !p.eliminated);
        if (survivors.length <= 1) {
            gameState.gamePhase = 'game_over';
            const winner = survivors[0] ?? null;
            const payload = {
                winner: winner ? { id: winner.id, name: winner.name } : null,
                reason: winner ? `${winner.name} is the last one standing.` : 'Nobody walked out of here.',
            };
            sendMessage('GAME_OVER', payload);
            showGameOver(payload);
        } else {
            startNewRound();
        }
    }, ROULETTE_RESOLVE_MS);
}

/* ------------------------------------------------------------------ */
/* player actions                                                      */
/* ------------------------------------------------------------------ */

export function handlePlayCards(playerId, playedCardIds, { auto = false } = {}) {
    if (!localPlayer.isHost) return;
    if (playerId !== gameState.currentPlayerId || gameState.gamePhase !== 'playing') return;

    const player = gameState.players.find((p) => p.id === playerId);
    if (!player || player.eliminated || player.cardCount === 0) return;

    if (!playedCardIds?.length || playedCardIds.length > MAX_CARDS_PER_PLAY) {
        broadcastState();
        return;
    }

    // validate: every id must really be in that player's hand
    const remaining = [...player.hand];
    const played = [];
    for (const cardId of playedCardIds) {
        const idx = remaining.findIndex((c) => c.id === cardId);
        if (idx === -1) {
            broadcastState();
            return;
        }
        played.push(remaining.splice(idx, 1)[0]);
    }

    player.hand = remaining;
    player.cardCount = player.hand.length;

    gameState.lastPlayedTurn = {
        playerId,
        playerName: player.name,
        cardsPlayed: played,
        cardsPlayedCount: played.length,
        declaredSuit: gameState.currentTableSuit,
    };
    gameState.centerPile.push(...played);
    gameState.centerPileCardCount = gameState.centerPile.length;

    addLog(
        `${player.name} ${auto ? 'auto-played' : 'plays'} ${played.length} as `
        + `${SUIT_SYMBOLS[gameState.currentTableSuit]}.`,
        'system',
    );

    if (el.game.classList.contains('is-active')) {
        flyCards(seatNodeFor(playerId), el.pile, played.length);
        sfx.cardPlay(played.length);
    }

    // emptied their hand → straight to the revolver
    if (player.cardCount === 0) {
        gameState.gamePhase = 'roulette';
        const results = fireRevolver(player);
        if (!results) return;
        resolveRoulette({ ...results, isCardDepletion: true });
        return;
    }

    advanceTurnFrom(playerId);
    broadcastState();
}

export function handleCallLiar(challengerId) {
    if (!localPlayer.isHost) return;
    if (challengerId !== gameState.currentPlayerId) return;
    if (!gameState.lastPlayedTurn || gameState.gamePhase !== 'playing') return;

    const challenger = gameState.players.find((p) => p.id === challengerId);
    const accused = gameState.players.find((p) => p.id === gameState.lastPlayedTurn.playerId);
    if (!challenger || challenger.eliminated || !accused) return;

    gameState.gamePhase = 'challenge_reveal';
    disarmHostTimer();

    const played = gameState.lastPlayedTurn.cardsPlayed;
    const tableSuit = gameState.currentTableSuit;
    const wasLie = !Deck.isTruthful(played, tableSuit);

    addLog(`${challenger.name} calls LIAR on ${accused.name}.`, 'system');
    addLog(
        wasLie ? `${accused.name} was lying.` : `${accused.name} was telling the truth.`,
        wasLie ? 'error' : 'success',
    );

    const results = fireRevolver(wasLie ? accused : challenger);
    if (!results) return;

    resolveRoulette({
        ...results,
        isCardDepletion: false,
        challenger: { id: challenger.id, name: challenger.name },
        accused: { id: accused.id, name: accused.name },
        playedCards: played,
        tableSuit,
        claimWasLie: wasLie,
    });
}

export function handleRematchVote(clientId, isReady) {
    if (!localPlayer.isHost || gameState.gamePhase !== 'game_over') return;

    const eligible = activeConnectedIds();
    if (!eligible.includes(clientId)) {
        if (clientId in gameState.rematchReadyStatus) {
            delete gameState.rematchReadyStatus[clientId];
            broadcastState();
        }
        return;
    }

    gameState.rematchReadyStatus[clientId] = isReady;
    updateRematchStatus();

    const allReady = eligible.length > 0 && eligible.every((id) => gameState.rematchReadyStatus[id] === true);
    if (eligible.length >= MIN_PLAYERS && allReady) {
        addLog('Everyone is in. Dealing a rematch…', 'success');
        startRematch();
    } else {
        broadcastState();
    }
}

export function startRematch() {
    startNewGame();
    showGameBoard();
}

export function handleNameUpdate(clientId, name) {
    if (!localPlayer.isHost) return;
    const player = gameState.players.find((p) => p.id === clientId);
    if (!player) return;
    player.name = name;
    updateLobbySeats();
    broadcastState();
}

/* ------------------------------------------------------------------ */
/* disconnects                                                         */
/* ------------------------------------------------------------------ */

export function handleClientDisconnect(clientId) {
    if (!localPlayer.isHost) return;

    delete session.hostConnections[clientId];

    const player = gameState.players.find((p) => p.id === clientId);
    if (!player) {
        updateLobbySeats();
        return;
    }

    if (gameState.gamePhase === 'lobby') {
        gameState.players = gameState.players.filter((p) => p.id !== clientId);
        addLog(`${player.name} left the table.`, 'system');
        toast(`${player.name} left.`, { type: 'info' });
        sfx.leave();
        updateLobbySeats();
        return;
    }

    if (gameState.gamePhase === 'game_over') {
        delete gameState.rematchReadyStatus[clientId];
        addLog(`${player.name} left — dropped from the rematch.`, 'system');

        const eligible = activeConnectedIds();
        const allReady = eligible.length > 0 && eligible.every((id) => gameState.rematchReadyStatus[id] === true);
        if (eligible.length >= MIN_PLAYERS && allReady) startRematch();
        else {
            updateRematchStatus();
            broadcastState();
        }
        return;
    }

    // mid-game: treat a disconnect as an elimination
    if (!player.eliminated) {
        player.eliminated = true;
        player.cardCount = 0;
        addLog(`${player.name} disconnected and is out.`, 'error');
        toast(`${player.name} disconnected.`, { type: 'error' });

        const survivors = gameState.players.filter((p) => !p.eliminated);
        if (survivors.length <= 1) {
            gameState.gamePhase = 'game_over';
            disarmHostTimer();
            const winner = survivors[0] ?? null;
            const payload = {
                winner: winner ? { id: winner.id, name: winner.name } : null,
                reason: winner
                    ? `${winner.name} wins — everyone else walked out.`
                    : 'The table emptied out.',
            };
            sendMessage('GAME_OVER', payload);
            showGameOver(payload);
            return;
        }

        if (gameState.currentPlayerId === clientId) advanceTurnFrom(clientId);
    }

    broadcastState();
}

/** Called when the host leaves or the game resets. */
export function stopHostTimers() {
    disarmHostTimer();
}
