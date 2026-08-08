/**
 * ui.js — screen transitions and the handlers that both host and client share.
 */

import { el, openModal, closeModal } from './dom.js';
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
import { activeConnectedIds } from './net.js';
import { resetLobby, renderWaitroom, goToStep } from './lobby.js';
import { setTopbar } from './topbar.js';

/* ------------------------------------------------------------------ */
/* screens                                                             */
/* ------------------------------------------------------------------ */

export function showLobby() {
    disarmHostTimer();
    stopCountdown();
    cancelRoulette();

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
    clearLog();
    clearSelection();
    if (name) el.nameInput.value = name;

    resetLobby();
}

export function showGameBoard() {
    [el.rouletteModal, el.gameOverModal, el.rulesModal].forEach(closeModal);

    el.lobby.classList.remove('is-active');
    el.game.classList.add('is-active');

    setTopbar({
        back: true,
        backLabel: 'Leave table',
        roomCode: session.roomCode,
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
            `New round — table suit is ${SUIT_SYMBOLS[gameState.currentTableSuit]} ${gameState.currentTableSuit}.`,
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
/* game over                                                           */
/* ------------------------------------------------------------------ */

export function showGameOver(data) {
    gameState.gamePhase = 'game_over';
    disarmHostTimer();
    stopCountdown();

    gameState.rematchReadyStatus = {};
    activeConnectedIds().forEach((id) => { gameState.rematchReadyStatus[id] = false; });
    localPlayer.readyForRematch = false;

    const iWon = data.winner?.id === localPlayer.id;

    el.gameOverOrnament.classList.toggle('is-good', iWon);
    el.gameOverOrnament.classList.toggle('is-danger', !iWon);
    el.gameOverTitle.textContent = data.winner
        ? (iWon ? 'You walk out' : `${data.winner.name} walks out`)
        : 'Nobody wins';
    el.gameOverTitle.className = `modal__title ${iWon ? 'is-good' : 'is-danger'}`;
    el.gameOverMessage.textContent = data.reason;
    addLog(data.reason, 'system');

    el.playAgainBtn.textContent = 'Ready for rematch';
    el.playAgainBtn.className = 'btn btn--primary';
    el.playAgainBtn.disabled = false;

    updateRematchStatus();
    closeModal(el.rouletteModal);
    openModal(el.gameOverModal);

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
