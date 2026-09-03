/**
 * ui.js: screen transitions and the handlers that both host and client share.
 */

import { el, openModal, closeModal, isModalOpen } from './dom.js';
import { MAX_PLAYERS, MIN_PLAYERS, SUIT_SYMBOLS, PLAYER_COLORS } from './constants.js';
import {
    gameState, localPlayer, session,
    resetGameState, resetSession, resetLocalPlayer, colorFor, initialsFor,
} from './state.js';
import { updateBoard, resetBoardMemory } from './board.js';
import { invalidateHand, clearSelection } from './hand.js';
import { resetSeatMemory, seatNodeFor } from './seats.js';
import { flyCards } from './cards.js';
import { icon } from './icons.js';
import { playRoulette, cancelRoulette } from './roulette.js';
import { syncCountdown, stopCountdown, disarmHostTimer } from './timer.js';
import { addLog, clearLog, toggleLog } from './log.js';
import { sfx } from './audio.js';
import * as fx from './fx.js';
import { activeConnectedIds, resetLink } from './net.js';
import { resetLobby, renderWaitroom, goToStep } from './lobby.js';
import { setTopbar } from './topbar.js';
import { clearReactions } from './reactions.js';

/* ------------------------------------------------------------------ */
/* screens                                                             */
/* ------------------------------------------------------------------ */

export function showLobby() {
    disarmHostTimer();
    stopCountdown();
    cancelRoulette();
    resetLink();

    [el.rouletteModal, el.gameOverModal, el.rulesModal, el.confirmModal].forEach(closeModal);
    toggleLog(false);

    el.game.classList.remove('is-active');
    el.lobby.classList.add('is-active');

    const name = el.nameInput.value.trim() || localPlayer.name;
    resetGameState();
    resetSession();
    resetLocalPlayer(name);
    resetBoardMemory();
    resetSeatMemory();
    clearReactions();
    clearLog();
    clearSelection();
    if (name) el.nameInput.value = name;

    resetLobby();
}

export function showGameBoard() {
    [el.rouletteModal, el.gameOverModal, el.rulesModal].forEach(closeModal);

    el.lobby.classList.remove('is-active');
    el.game.classList.add('is-active');

    /*
     * No room code here. It belongs to the waiting room, where its whole job is
     * being read out to the people you are trying to get to the table; once the
     * cards are dealt the seats are full and it is a five-character chip sitting
     * over the felt for the rest of the game, doing nothing.
     */
    setTopbar({
        back: true,
        backLabel: 'Leave table',
        inGame: true,
    });

    invalidateHand();
    refreshBoard({ dealt: true });
    sfx.deal(localPlayer.hand?.length ?? 5);
}

export const isBoardVisible = () => el.game.classList.contains('is-active');

/** Repaint everything that depends on gameState. */
export function refreshBoard({ dealt = false } = {}) {
    updateBoard({ dealt });
    syncCountdown();
}

/* ------------------------------------------------------------------ */
/* lobby seats                                                         */
/* ------------------------------------------------------------------ */

/** The waiting room owns its own rendering; this is just the hand-off. */
export function updateLobbySeats() {
    renderWaitroom();
}

/* ------------------------------------------------------------------ */
/* client state sync                                                   */
/* ------------------------------------------------------------------ */

export function onClientStateUpdate(payload) {
    const prev = session.lastSeenState ?? {};
    const wasGameOver = prev.gamePhase === 'game_over';
    const prevSuit = prev.currentTableSuit;
    const prevPlay = prev.lastPlayedTurn;
    const prevTurn = prev.currentPlayerId;

    Object.assign(gameState, payload.gameState);
    if (payload.yourHand !== undefined) localPlayer.hand = payload.yourHand;
    const me = gameState.players.find((p) => p.id === localPlayer.id);
    if (me) Object.assign(localPlayer, me);

    // --- screen transitions ---
    if (gameState.gamePhase === 'playing' && wasGameOver) {
        closeModal(el.gameOverModal);
        closeModal(el.rouletteModal);
        showGameBoard();
    } else if (gameState.gamePhase !== 'lobby' && !isBoardVisible()) {
        showGameBoard();
    } else if (gameState.gamePhase === 'lobby' && isBoardVisible()) {
        showLobby();
        return;
    }

    // --- narration ---
    const newRound = gameState.currentTableSuit && gameState.currentTableSuit !== prevSuit;
    if (newRound && gameState.gamePhase === 'playing') {
        addLog(
            `New round: the table suit is ${SUIT_SYMBOLS[gameState.currentTableSuit]} ${gameState.currentTableSuit}.`,
            'system',
        );
        sfx.newRound();
        invalidateHand();
    }

    const play = gameState.lastPlayedTurn;
    if (play && JSON.stringify(play) !== JSON.stringify(prevPlay)) {
        addLog(
            `${play.playerName} plays ${play.cardsPlayedCount} as ${SUIT_SYMBOLS[play.declaredSuit]}.`,
            'system',
        );
        if (isBoardVisible()) {
            flyCards(seatNodeFor(play.playerId), el.pile, play.cardsPlayedCount);
            sfx.cardPlay(play.cardsPlayedCount);
        }
    }

    if (gameState.currentPlayerId && gameState.currentPlayerId !== prevTurn) {
        const current = gameState.players.find((p) => p.id === gameState.currentPlayerId);
        if (current) addLog(`${current.name}'s turn.`, 'info');
    }

    /*
     * Who is in contact is part of the state now, so every client can narrate
     * it rather than only the host. Worth saying out loud: a table that can see
     * somebody has dropped out waits for them instead of assuming they are
     * ignoring their turn.
     */
    const wasAway = new Map((prev.players ?? []).map((p) => [p.id, !!p.away]));
    gameState.players.forEach((p) => {
        if (!wasAway.has(p.id) || wasAway.get(p.id) === !!p.away) return;
        addLog(
            p.away ? `${p.name} dropped out of contact.` : `${p.name} is back.`,
            p.away ? 'error' : 'success',
        );
    });

    if (gameState.gamePhase !== 'lobby') refreshBoard({ dealt: newRound });
    if (gameState.gamePhase === 'game_over') updateRematchStatus();

    session.lastSeenState = JSON.parse(JSON.stringify(gameState));
}

/* ------------------------------------------------------------------ */
/* roulette                                                            */
/* ------------------------------------------------------------------ */

export function applyRouletteResults(data) {
    gameState.gamePhase = 'roulette';
    stopCountdown();

    data.updatedPlayersData.forEach((update) => {
        const player = gameState.players.find((p) => p.id === update.id);
        if (player) Object.assign(player, update);
        if (localPlayer.id === update.id) Object.assign(localPlayer, update);
    });

    if (!localPlayer.isHost) {
        if (data.isCardDepletion) {
            addLog(`${data.rouletteTarget.name} emptied their hand.`, 'system');
        } else {
            addLog(`${data.challenger.name} calls LIAR on ${data.accused.name}.`, 'system');
            addLog(
                data.claimWasLie
                    ? `${data.accused.name} was lying.`
                    : `${data.accused.name} was telling the truth.`,
                data.claimWasLie ? 'error' : 'success',
            );
        }
    }

    const targetAfter = data.updatedPlayersData.find((p) => p.id === data.rouletteTarget.id);
    playRoulette(data, targetAfter);

    clearSelection();
    refreshBoard();
}

/* ------------------------------------------------------------------ */
/* the ledger                                                          */
/* ------------------------------------------------------------------ */

/**
 * Titles worth printing, in the order they get offered.
 *
 * Every one has a floor under it, because the interesting failure here is a
 * two-round game handing out "Coldest nerve" for surviving a single pull. A
 * player who did nothing remarkable should get no title at all, and an empty
 * honours row is the correct output for a short, dull game.
 */
const HONOURS = [
    {
        label: 'Biggest bluff',
        qualifies: (s) => s.bluff >= 2,
        rank: (s) => s.bluff,
        line: (s) => `${s.bluff} cards face down, not one of them honest.`,
    },
    {
        label: 'Best read',
        qualifies: (s) => s.callsGood >= 2,
        rank: (s) => s.callsGood,
        line: (s) => `Called it right ${s.callsGood} times out of ${s.callsMade}.`,
    },
    {
        label: 'Coldest nerve',
        qualifies: (s) => s.survived >= 2,
        rank: (s) => s.survived,
        line: (s) => `Heard the click ${s.survived} times and sat back down.`,
    },
    {
        label: 'Straightest face',
        qualifies: (s) => s.lies - s.caught >= 2,
        rank: (s) => s.lies - s.caught,
        line: (s) => `Lied ${s.lies - s.caught} times without anyone calling it.`,
    },
    {
        label: 'Honest to a fault',
        qualifies: (s) => s.lies === 0 && s.plays >= 3,
        rank: (s) => s.plays,
        line: (s) => `${s.plays} plays, every card exactly what it was claimed to be.`,
    },
];

/** At most this many titles, or the ledger stops being a summary. */
const MAX_HONOURS = 3;

function honoursFrom(players) {
    const awarded = [];
    const taken = new Set();

    for (const honour of HONOURS) {
        if (awarded.length >= MAX_HONOURS) break;
        const winner = players
            .filter(honour.qualifies)
            /*
             * Rank first, and only then prefer somebody who hasn't been named
             * yet. Spreading the titles is worth having, but not at the cost of
             * handing "Best read" to the second-best read in the room: the tie
             * is the only place where the choice is genuinely free.
             */
            .sort((a, b) => honour.rank(b) - honour.rank(a)
                || Number(taken.has(a.id)) - Number(taken.has(b.id)))[0];

        if (!winner) continue;
        taken.add(winner.id);
        awarded.push({ ...honour, winner });
    }
    return awarded;
}

function honourNode({ label, line, winner }) {
    const row = document.createElement('div');
    row.className = 'honour';
    row.style.setProperty('--seat-color', colorFor(winner.id));

    const title = document.createElement('span');
    title.className = 'honour__label';
    title.textContent = label;

    const who = document.createElement('span');
    who.className = 'honour__name';
    who.textContent = winner.name;

    const detail = document.createElement('span');
    detail.className = 'honour__line';
    detail.textContent = line(winner);

    row.append(title, who, detail);
    return row;
}

function ledgerRow(player) {
    const tr = document.createElement('tr');
    if (player.id === localPlayer.id) tr.className = 'is-me';
    tr.style.setProperty('--seat-color', colorFor(player.id));

    const place = document.createElement('td');
    place.className = 'ledger__num ledger__place';
    place.textContent = player.place || '—';

    const name = document.createElement('td');
    name.className = 'ledger__who';
    const chip = document.createElement('span');
    chip.className = 'ledger__chip';
    name.append(chip, document.createTextNode(player.name));

    // a dash rather than a zero: they never took the action, which is a
    // different thing from taking it and getting nothing out of it
    const cells = [
        player.plays || '—',
        player.lies || '—',
        player.callsMade ? `${player.callsGood}/${player.callsMade}` : '—',
        player.shots ? `${player.survived}/${player.shots}` : '—',
    ].map((text, i) => {
        const td = document.createElement('td');
        td.className = `ledger__num${i === 0 ? ' ledger__col-wide' : ''}`;
        td.textContent = String(text);
        return td;
    });

    tr.append(place, name, ...cells);
    return tr;
}

function renderLedger(ledger) {
    const players = ledger?.players ?? [];
    // nobody played a card, so there is nothing to account for
    const worthPrinting = players.some((p) => p.plays > 0 || p.shots > 0);

    el.ledger.hidden = !worthPrinting;
    if (!worthPrinting) return;

    const rounds = ledger.rounds ?? 0;
    el.ledgerRounds.textContent = rounds === 1 ? '1 round' : `${rounds} rounds`;

    el.ledgerHonours.innerHTML = '';
    honoursFrom(players).forEach((honour) => el.ledgerHonours.appendChild(honourNode(honour)));

    el.ledgerRows.innerHTML = '';
    [...players]
        .sort((a, b) => (a.place || 99) - (b.place || 99))
        .forEach((player) => el.ledgerRows.appendChild(ledgerRow(player)));
}

/* ------------------------------------------------------------------ */
/* game over                                                           */
/* ------------------------------------------------------------------ */

export function showGameOver(data) {
    /*
     * The ending is replayed to anyone who reconnects, and to anyone whose
     * resync finds them behind — which can happen to a player who is already
     * sitting in front of this dialog. So a second showing is a repaint and
     * nothing more: it must not clear a rematch vote somebody has already cast,
     * and it must not throw the confetti twice.
     */
    const repeat = gameState.gamePhase === 'game_over' && isModalOpen(el.gameOverModal);

    gameState.gamePhase = 'game_over';
    disarmHostTimer();
    stopCountdown();

    if (!repeat) {
        gameState.rematchReadyStatus = {};
        activeConnectedIds().forEach((id) => { gameState.rematchReadyStatus[id] = false; });
        localPlayer.readyForRematch = false;
    }

    const iWon = data.winner?.id === localPlayer.id;

    el.gameOverOrnament.classList.toggle('is-good', iWon);
    el.gameOverOrnament.classList.toggle('is-danger', !iWon);
    el.gameOverTitle.textContent = data.winner
        ? (iWon ? 'You walk out' : `${data.winner.name} walks out`)
        : 'Nobody wins';
    el.gameOverTitle.className = `modal__title ${iWon ? 'is-good' : 'is-danger'}`;
    el.gameOverMessage.textContent = data.reason;

    if (!repeat) {
        el.playAgainBtn.textContent = 'Ready for rematch';
        el.playAgainBtn.className = 'btn btn--primary';
        el.playAgainBtn.disabled = false;
    }

    renderLedger(data.ledger);
    updateRematchStatus();
    closeModal(el.rouletteModal);
    openModal(el.gameOverModal);

    if (repeat) {
        refreshBoard();
        return;
    }

    addLog(data.reason, 'system');

    if (iWon) {
        sfx.victory();
        fx.confetti();
        setTimeout(() => fx.embers(50), 400);
    } else {
        sfx.defeat();
    }

    refreshBoard();
}

export function updateRematchStatus() {
    if (gameState.gamePhase !== 'game_over') {
        el.rematchStatus.hidden = true;
        return;
    }

    el.rematchStatus.hidden = false;
    el.rematchList.innerHTML = '';

    /*
     * A rematch waits on everyone still in contact, so if the room has thinned
     * out below the minimum it will wait for ever. Nothing about the dialog
     * showed that: the button worked, the chip went green, and nothing
     * happened. Say it instead.
     */
    const present = activeConnectedIds().length;
    if (present < MIN_PLAYERS) {
        const note = document.createElement('span');
        note.className = 'rematch__note';
        note.textContent = present <= 1
            ? 'Everyone else has gone. Leave the table to start a new one.'
            : `Waiting for ${MIN_PLAYERS - present} more.`;
        el.rematchList.appendChild(note);
    }

    activeConnectedIds().forEach((id) => {
        const player = gameState.players.find((p) => p.id === id);
        if (!player) return;

        const ready = gameState.rematchReadyStatus[id] === true;
        const chip = document.createElement('span');
        chip.className = `rematch__chip${ready ? ' is-ready' : ''}`;
        chip.style.setProperty('--seat-color', colorFor(id));
        if (ready) chip.appendChild(icon('check'));
        chip.appendChild(document.createTextNode(player.name));
        el.rematchList.appendChild(chip);
    });
}
