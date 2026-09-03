/**
 * game.js: host-authoritative game logic. Only the host ever runs any of this;
 * clients just render whatever gets broadcast back to them.
 */

import {
    SUITS, RANKS, SUIT_SYMBOLS, HAND_SIZE, MIN_PLAYERS, MAX_CARDS_PER_PLAY,
    REVOLVER_CHAMBERS, REVOLVER_BULLETS, AWAY_AUTOPLAY_MS, NAME_MAX, planRoulette,
} from './constants.js';
import { gameState, localPlayer, session } from './state.js';
import { sendMessage, activeConnectedIds, lastSeenOf } from './net.js';
import { addLog } from './log.js';
import { toast } from './toast.js';
import {
    armHostTimer, disarmHostTimer, hostRemainingMs, afterHostDelay, cancelHostDelays,
} from './timer.js';
import {
    applyRouletteResults, showGameOver, updateRematchStatus, refreshBoard, showGameBoard,
    updateLobbySeats,
} from './ui.js';
import { flyCards } from './cards.js';
import { seatNodeFor, resetSeatMemory } from './seats.js';
import { el } from './dom.js';
import { sfx } from './audio.js';
import { isReaction, showReaction, clearReactions, REACTION_COOLDOWN_MS } from './reactions.js';

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
/* the ledger                                                          */
/* ------------------------------------------------------------------ */

/**
 * What the table gets told about itself when it's over.
 *
 * Host-only, and kept out of `broadcastState` on purpose: this grows with every
 * play and nobody reads it until the last player is standing, so it rides on
 * the GAME_OVER payload instead of on all several-hundred state updates before
 * it. Counters only — no card is ever recorded — because a ledger that could
 * reconstruct a hand would turn the log panel into an oracle.
 */
function blankStats() {
    return {
        plays: 0,      // times they put cards down
        cards: 0,      // cards in total
        lies: 0,       // plays holding at least one card that wasn't the suit
        bluff: 0,      // most off-suit cards in a single play
        auto: 0,       // plays the turn timer made for them
        callsMade: 0,  // times they called LIAR
        callsGood: 0,  // ...and were right
        accused: 0,    // times LIAR was called on them
        caught: 0,     // ...and the caller was right
        shots: 0,      // times they faced the revolver
        survived: 0,   // ...and heard a click
        emptied: 0,    // times they played their hand out
        place: 0,      // finishing position, 1 is the last one breathing
    };
}

function statsFor(playerId) {
    const all = gameState.stats;
    if (!all[playerId]) all[playerId] = blankStats();
    return all[playerId];
}

/**
 * Place people from the bottom up as they go out, so the order is right even
 * though the game is only ever certain of its winner at the very end.
 */
function recordElimination(player) {
    const stats = statsFor(player.id);
    if (stats.place) return;
    stats.place = gameState.players.length - gameState.eliminatedCount;
    gameState.eliminatedCount += 1;
}

/** Everyone still standing when the music stops, ranked above everyone who isn't. */
function closeLedger(survivors) {
    survivors.forEach((player, i) => {
        const stats = statsFor(player.id);
        if (!stats.place) stats.place = i + 1;
    });
    return {
        rounds: gameState.roundsPlayed,
        players: gameState.players.map((p) => ({ id: p.id, name: p.name, ...statsFor(p.id) })),
    };
}

/* ------------------------------------------------------------------ */
/* broadcasting                                                        */
/* ------------------------------------------------------------------ */

/**
 * The authoritative state as one player is allowed to see it: everything
 * public, plus their own hand and nobody else's.
 *
 * Split out from `broadcastState` because it is also what answers a resync —
 * a client that noticed it had fallen behind asks for exactly this, and a
 * player who reconnects mid-round is handed it as part of being welcomed back.
 */
export function stateForClient(player) {
    return {
        gameState: {
            players: gameState.players.map((p) => ({
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                eliminated: p.eliminated,
                away: !!p.away,
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
            stateVersion: gameState.stateVersion ?? 0,
        },
        yourHand: player.hand,
    };
}

export function broadcastState() {
    if (!localPlayer.isHost) return;

    /*
     * Every broadcast is numbered, and the number rides on the heartbeat as
     * well. That is what makes a missed update recoverable: a client whose copy
     * is behind the pulse asks for the state back within one beat, rather than
     * finding out when somebody says "it's your turn" out loud.
     */
    gameState.stateVersion = (gameState.stateVersion ?? 0) + 1;

    gameState.players.forEach((p) => {
        if (p.id !== localPlayer.id && session.hostConnections[p.id]) {
            sendMessage('GAME_STATE_UPDATE', stateForClient(p), p.id);
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
        /*
         * Nobody left to hand the turn to. Reachable only if the survivor count
         * and the turn disagree, but the cost of being wrong here is a table
         * with no clock running and no player on it, which no timer will ever
         * come back to. End it rather than hang it.
         */
        if (!advanceTurnFrom(gameState.currentPlayerId)) {
            const survivors = gameState.players.filter((p) => !p.eliminated);
            declareGameOver({
                winner: survivors[0] ?? null,
                reason: survivors[0]
                    ? `${survivors[0].name} is the last one standing.`
                    : 'Nobody walked out of here.',
                survivors,
            });
            return;
        }
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
            away: false,
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
            away: false,
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

    gameState.stats = {};
    gameState.roundsPlayed = 0;
    gameState.eliminatedCount = 0;
    roster.forEach((p) => statsFor(p.id));

    // a rematch dealt over the top of the old game's hand-off would deal twice
    cancelHostDelays();
    lastGameOver = null;

    resetSeatMemory();
    clearReactions();
    lastReactionAt.clear();
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
    gameState.roundsPlayed += 1;

    addLog(
        `New round: the table suit is ${SUIT_SYMBOLS[gameState.currentTableSuit]} ${gameState.currentTableSuit}.`,
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
/* ending it                                                           */
/* ------------------------------------------------------------------ */

/**
 * The last GAME_OVER this host declared.
 *
 * Kept because the announcement is a single broadcast and a single broadcast is
 * exactly what a phone misses. Without this, a player who was offline at the
 * moment the game ended reconnects into `gamePhase: 'game_over'` with no result,
 * no ledger and no rematch button — stranded on a dead board, and the only way
 * out is to leave the table, which is how a lobby stops existing.
 *
 * Host-only and never in `broadcastState`: it is replayed privately to whoever
 * asks, on the handshake and on a resync.
 */
let lastGameOver = null;

export const gameOverPayload = () => lastGameOver;

/** Declare it, remember it, tell everyone. The only way the game ends. */
function declareGameOver({ winner, reason, survivors }) {
    gameState.gamePhase = 'game_over';
    disarmHostTimer();
    cancelHostDelays();

    lastGameOver = {
        winner: winner ? { id: winner.id, name: winner.name } : null,
        reason,
        ledger: closeLedger(survivors),
    };

    sendMessage('GAME_OVER', lastGameOver);
    showGameOver(lastGameOver);
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

    // captured before the pop: the animation draws the cylinder as it stood
    // when the target picked it up, then takes this round out of it
    const chambersBefore = target.revolverDeck.length;

    const fired = target.revolverDeck.pop();
    target.revolverChambersLeft = target.revolverDeck.length;

    const stats = statsFor(target.id);
    stats.shots += 1;

    let outcomeText;
    if (fired === 'lethal') {
        target.eliminated = true;
        target.cardCount = 0;
        recordElimination(target);
        outcomeText = `BANG! ${target.name} is eliminated.`;
    } else {
        stats.survived += 1;
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
        chambersBefore,
        // every client plans the same sequence from this, so the cylinder lands
        // on the same chamber and holds for the same beat everywhere
        rouletteSeed: (Math.random() * 0x7fffffff) | 0,
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

    /*
     * The hold before the trigger is 2 to 5 seconds depending on the seed, so
     * the wait here cannot be a constant: the host would either talk over the
     * end of the animation or leave everyone staring at a spent cylinder. Same
     * seed, same plan, same length on every client.
     */
    const { totalMs } = planRoulette({
        seed: results.rouletteSeed,
        chambersBefore: results.chambersBefore,
    });

    /*
     * `afterHostDelay`, not `setTimeout`: this is the hand-off that deals the
     * next round, and the turn timer is disarmed until it runs. If it does not
     * run — a host whose page suspends while the shot is on screen, which is
     * precisely when a phone gets put down — nothing else is left ticking to
     * notice, and the whole table sits on a spent cylinder for good.
     */
    afterHostDelay(totalMs, () => {
        const survivors = gameState.players.filter((p) => !p.eliminated);
        if (survivors.length <= 1) {
            const winner = survivors[0] ?? null;
            declareGameOver({
                winner,
                reason: winner
                    ? `${winner.name} is the last one standing.`
                    : 'Nobody walked out of here.',
                survivors,
            });
        } else {
            startNewRound();
        }
    });
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

    const stats = statsFor(playerId);
    const offSuit = played.filter((c) => c.suit !== gameState.currentTableSuit).length;
    stats.plays += 1;
    stats.cards += played.length;
    if (auto) stats.auto += 1;
    if (offSuit) {
        stats.lies += 1;
        stats.bluff = Math.max(stats.bluff, offSuit);
    }

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
        stats.emptied += 1;
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

    const callerStats = statsFor(challenger.id);
    const accusedStats = statsFor(accused.id);
    callerStats.callsMade += 1;
    accusedStats.accused += 1;
    if (wasLie) {
        callerStats.callsGood += 1;
        accusedStats.caught += 1;
    }

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

/* ------------------------------------------------------------------ */
/* reactions                                                           */
/* ------------------------------------------------------------------ */

/** clientId -> when they last rang the bell, so nobody can lean on it. */
const lastReactionAt = new Map();

/** Put a mark on every other screen. Does not draw it here. */
export function broadcastReaction(playerId, mark) {
    sendMessage('REACTION', { playerId, mark });
}

/**
 * A client rang the bell. The rate limit is the point of routing this through
 * the host at all: a client that ignores its own cooldown gets its extra marks
 * dropped here rather than on seven other people's tables.
 */
export function handleReaction(clientId, mark) {
    if (!localPlayer.isHost || !isReaction(mark)) return;
    if (!gameState.players.some((p) => p.id === clientId)) return;

    const now = Date.now();
    if (now - (lastReactionAt.get(clientId) ?? 0) < REACTION_COOLDOWN_MS) return;
    lastReactionAt.set(clientId, now);

    broadcastReaction(clientId, mark);
    showReaction(clientId, mark);
}

export function handleNameUpdate(clientId, name) {
    if (!localPlayer.isHost) return;
    const player = gameState.players.find((p) => p.id === clientId);
    if (!player) return;

    // the host retypes what it is told rather than trusting it: this is the one
    // client-supplied string that ends up on seven other people's screens, and
    // the sender is only as well-behaved as the build it is running
    const clean = String(name ?? '').trim().slice(0, NAME_MAX);
    if (!clean) return;

    player.name = clean;
    updateLobbySeats();
    broadcastState();
}

/* ------------------------------------------------------------------ */
/* going away, and coming back                                         */
/* ------------------------------------------------------------------ */

/*
 * Leaving used to be a single event, because the only leaving the game could
 * see was a browser tab closing. On a table full of phones that is the rare
 * case; the common one is a screen locking for forty seconds, and eliminating
 * somebody for that is both wrong and unrecoverable.
 *
 * So there are two states. `away` is set by the heartbeat sweep and costs
 * nothing but a struck seat: the turn timer already keeps the game moving, and
 * the hand is still theirs when they come back. Gone is what happens after two
 * minutes of it, or the moment somebody actually presses leave, and only that
 * ends anyone's game.
 */

/** They pressed leave, or they have been away long enough to mean it. */
export function handlePlayerGone(playerId, { reason = 'timeout' } = {}) {
    if (!localPlayer.isHost) return;

    delete session.hostConnections[playerId];

    const player = gameState.players.find((p) => p.id === playerId);
    if (!player) {
        updateLobbySeats();
        return;
    }

    const walked = reason === 'left';

    if (gameState.gamePhase === 'lobby') {
        gameState.players = gameState.players.filter((p) => p.id !== playerId);
        addLog(`${player.name} left the table.`, 'system');
        toast(`${player.name} left.`, { type: 'info' });
        sfx.leave();
        updateLobbySeats();
        broadcastState();
        return;
    }

    if (gameState.gamePhase === 'game_over') {
        delete gameState.rematchReadyStatus[playerId];
        addLog(`${player.name} left, so they are dropped from the rematch.`, 'system');

        const eligible = activeConnectedIds();
        const allReady = eligible.length > 0 && eligible.every((id) => gameState.rematchReadyStatus[id] === true);
        if (eligible.length >= MIN_PLAYERS && allReady) startRematch();
        else {
            updateRematchStatus();
            broadcastState();
        }
        return;
    }

    // mid-game, and they are not coming back: that is an elimination
    if (!player.eliminated) {
        player.eliminated = true;
        player.away = false;
        player.cardCount = 0;
        recordElimination(player);
        addLog(
            walked ? `${player.name} walked out.` : `${player.name} never came back and is out.`,
            'error',
        );
        toast(walked ? `${player.name} left.` : `${player.name} timed out.`, { type: 'error' });

        const survivors = gameState.players.filter((p) => !p.eliminated);
        if (survivors.length <= 1) {
            const winner = survivors[0] ?? null;
            declareGameOver({
                winner,
                reason: winner
                    ? `${winner.name} wins because everyone else walked out.`
                    : 'The table emptied out.',
                survivors,
            });
            return;
        }

        if (gameState.currentPlayerId === playerId) advanceTurnFrom(playerId);
    }

    broadcastState();
}

/** They answered again. Their seat, their hand and their turn are all still theirs. */
export function handlePlayerBack(playerId) {
    if (!localPlayer.isHost) return;

    const player = gameState.players.find((p) => p.id === playerId);
    if (!player) return;

    if (player.away) {
        player.away = false;
        addLog(`${player.name} is back.`, 'success');
        toast(`${player.name} reconnected.`, { type: 'success' });
    }

    updateLobbySeats();
    broadcastState();
}

/**
 * With the turn timer switched off, nothing else will move a stalled game on.
 *
 * The timer is the proper answer to an absent player and it does the job in
 * every other configuration; this is only for tables that turned it off, where
 * one locked phone would otherwise hold seven people up indefinitely.
 */
export function sweepAwayTurn(now) {
    if (!localPlayer.isHost) return;
    if (gameState.gamePhase !== 'playing') return;
    if (gameState.config.turnSeconds) return;

    const current = gameState.players.find((p) => p.id === gameState.currentPlayerId);
    if (!current || current.eliminated || current.id === localPlayer.id) return;
    if (now - lastSeenOf(current.id) < AWAY_AUTOPLAY_MS) return;

    onTurnTimeout();
}

/** Called when the host leaves or the game resets. */
export function stopHostTimers() {
    disarmHostTimer();
    cancelHostDelays();
}

/**
 * Host: forget connection records for players who are no longer seated.
 *
 * `startNewGame` deals in only the players who were in contact, so anyone who
 * was away when the host dealt is dropped from the roster while their record
 * stays behind. The liveness sweep walks the roster, so nothing would ever
 * collect them, and they would go on counting towards "is anyone else here" for
 * the life of the tab.
 */
export function pruneConnections() {
    if (!localPlayer.isHost) return;
    for (const key of Object.keys(session.hostConnections)) {
        if (!gameState.players.some((p) => p.id === key)) delete session.hostConnections[key];
    }
}
