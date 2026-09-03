/**
 * main.js: boot, global wiring, keyboard shortcuts.
 */

import { el, openModal, closeModal, isModalOpen, MODAL_CLOSE_MS } from './dom.js';
import { gameState, localPlayer, session, isMyTurn, amEliminated } from './state.js';
import { connectServer, sendMessage, announceDeparture, resumeNetwork } from './net.js';
import {
    handlePlayCards, handleCallLiar, handleRematchVote, stopHostTimers, broadcastReaction,
} from './game.js';
import {
    initReactions, setReactionSender, sendReaction, REACTIONS, isTrayOpen, openTray,
} from './reactions.js';
import { showLobby, refreshBoard, isBoardVisible } from './ui.js';
import { initLobby, goToStep, currentStep } from './lobby.js';
import { initTopbar, onBack } from './topbar.js';
import { updateActions } from './board.js';
import { clearSelection, invalidateHand, animateSelectedOut } from './hand.js';
import { cancelRoulette } from './roulette.js';
import { toggleLog } from './log.js';
import { confirmDialog, isConfirmOpen, dismissConfirm, toast } from './toast.js';
import { unlock as unlockAudio, toggleMute, isMuted, sfx } from './audio.js';
import { setIcon } from './icons.js';

/* ------------------------------------------------------------------ */
/* audio unlock + mute                                                 */
/* ------------------------------------------------------------------ */

function paintSoundButton() {
    setIcon(el.soundIconUse, isMuted() ? 'sound-off' : 'sound-on');
    el.soundToggleBtn.classList.toggle('is-off', isMuted());
}

['pointerdown', 'keydown'].forEach((evt) =>
    window.addEventListener(evt, unlockAudio, { once: true, passive: true }),
);

el.soundToggleBtn.addEventListener('click', () => {
    toggleMute();
    paintSoundButton();
    if (!isMuted()) sfx.tap();
});
paintSoundButton();

/* ------------------------------------------------------------------ */
/* rules + log                                                         */
/* ------------------------------------------------------------------ */

const openRules = () => openModal(el.rulesModal);
el.rulesBtnGame.addEventListener('click', openRules);
el.closeRulesBtn.addEventListener('click', () => closeModal(el.rulesModal));
el.rulesModal.querySelector('.modal__backdrop').addEventListener('click', () => closeModal(el.rulesModal));

el.logToggleBtn.addEventListener('click', () => toggleLog());
el.logCloseBtn.addEventListener('click', () => toggleLog(false));

/* ------------------------------------------------------------------ */
/* reactions                                                           */
/* ------------------------------------------------------------------ */

/*
 * The host puts its own mark straight on the wire; everyone else asks the host
 * to. Either way `sendReaction` has already drawn it locally, so neither branch
 * displays anything.
 */
setReactionSender((mark) => {
    if (localPlayer.isHost) broadcastReaction(localPlayer.id, mark);
    else sendMessage('PLAYER_REACTION', { mark });
});

/* ------------------------------------------------------------------ */
/* playing                                                             */
/* ------------------------------------------------------------------ */

el.playBtn.addEventListener('click', () => {
    if (el.playBtn.disabled || !isMyTurn() || amEliminated()) return;

    const ids = session.selected.map((c) => c.id);
    if (!ids.length) return;

    animateSelectedOut();

    if (localPlayer.isHost) {
        handlePlayCards(localPlayer.id, ids);
    } else {
        // the epoch travels with the action: if this one sat in the outbox
        // through a reconnect, the host drops it rather than applying a play
        // meant for a hand that has since been dealt away
        sendMessage('PLAYER_ACTION_PLAY_CARDS', { cards: ids, turnEpoch: gameState.turnEpoch ?? 0 });
        sfx.cardPlay(ids.length);
    }

    clearSelection();
    invalidateHand();
    updateActions();
});

el.liarBtn.addEventListener('click', async () => {
    if (el.liarBtn.disabled || !isMyTurn() || !gameState.lastPlayedTurn) return;

    const accused = gameState.lastPlayedTurn.playerName;
    const ok = await confirmDialog({
        title: 'Call it?',
        message: `You're accusing ${accused} of lying. If they were telling the truth, `
            + 'you take the revolver.',
        confirmText: 'Call LIAR',
        cancelText: 'Back down',
    });
    if (!ok) return;

    // the table may have moved on while the dialog was up
    if (!isMyTurn() || !gameState.lastPlayedTurn) {
        toast('Too late. The turn already passed.', { type: 'warn' });
        return;
    }

    if (localPlayer.isHost) handleCallLiar(localPlayer.id);
    else sendMessage('PLAYER_ACTION_CALL_LIAR', { turnEpoch: gameState.turnEpoch ?? 0 });
});

el.continueBtn.addEventListener('click', () => {
    closeModal(el.rouletteModal);
    if (gameState.gamePhase === 'game_over' && !isModalOpen(el.gameOverModal)) {
        openModal(el.gameOverModal);
        return;
    }
    // the elimination landed while the revolver was still on screen and has
    // been held since; repaint once the modal is out of the way so the board
    // plays it where it can be seen
    setTimeout(refreshBoard, MODAL_CLOSE_MS + 20);
});

/* ------------------------------------------------------------------ */
/* rematch + leaving                                                   */
/* ------------------------------------------------------------------ */

el.playAgainBtn.addEventListener('click', () => {
    if (gameState.gamePhase !== 'game_over') return;

    localPlayer.readyForRematch = !localPlayer.readyForRematch;
    el.playAgainBtn.textContent = localPlayer.readyForRematch ? 'Waiting for others…' : 'Ready for rematch';
    el.playAgainBtn.className = `btn ${localPlayer.readyForRematch ? 'btn--ghost' : 'btn--primary'}`;
    sfx.tap();

    if (localPlayer.isHost) {
        handleRematchVote(localPlayer.id, localPlayer.readyForRematch);
    } else {
        sendMessage('PLAYER_TOGGLE_REMATCH_READY', { isReady: localPlayer.readyForRematch });
    }
});

function leaveTable() {
    announceDeparture();
    stopHostTimers();
    cancelRoulette();
    showLobby();
    toast('Left the table.', { type: 'info' });
}

el.exitGameBtn.addEventListener('click', leaveTable);

/*
 * One back button, three meanings. The floating controls don't know the rules, so the
 * decision about what "back" costs you lives here.
 */
onBack(async () => {
    sfx.tap();

    if (isBoardVisible()) {
        const ok = await confirmDialog({
            title: 'Leave the table?',
            message: localPlayer.isHost
                ? 'You are the host, so leaving ends the game for everyone.'
                : 'You will be eliminated from the current round.',
            confirmText: 'Leave',
            cancelText: 'Stay',
        });
        if (ok) leaveTable();
        return;
    }

    // in the waiting room: quietly give up the seat. on the join step: just back out.
    if (currentStep() === 'table') leaveTable();
    else goToStep('menu');
});

/* ------------------------------------------------------------------ */
/* the page going away, and coming back                                */
/* ------------------------------------------------------------------ */

/*
 * This used to announce a departure on `pagehide` as well, on the reasoning
 * that mobile Safari fires it where it does not reliably fire `beforeunload`.
 * It does — and that was the bug. On a phone `pagehide` also fires for
 * switching apps, for locking the screen, and for pulling down the
 * notification shade, none of which are leaving. A host who glanced at a text
 * message broadcast HOST_LEFT and sent the whole table back to the lobby.
 *
 * The two mistakes are not symmetrical. Announcing a departure that did not
 * happen ends everyone's game and cannot be taken back; failing to announce
 * one that did costs a couple of minutes of a struck-through seat, and the
 * heartbeat sweep clears it up on its own. So this listens only to the event
 * that means it, and lets the timeout handle everything else.
 */
window.addEventListener('beforeunload', announceDeparture);

/*
 * Coming back is the other half. A backgrounded tab has no timers, so the
 * heartbeat has been stopped for as long as the screen was off and the socket
 * has very likely been reaped underneath it. Nothing here can wait for the next
 * beat: the connection has to be re-established and both ends put back into
 * agreement in the same tick the page wakes up in.
 */
window.addEventListener('pageshow', resumeNetwork);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resumeNetwork();
});
// fired when the network itself comes back, which the socket can be slow to notice
window.addEventListener('online', resumeNetwork);

/* ------------------------------------------------------------------ */
/* keyboard                                                            */
/* ------------------------------------------------------------------ */

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (isConfirmOpen()) { dismissConfirm(); return; }
        if (isTrayOpen()) { openTray(false); return; }
        if (isModalOpen(el.rulesModal)) { closeModal(el.rulesModal); return; }
        if (el.logPanel.classList.contains('is-open')) { toggleLog(false); return; }
        return;
    }

    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (typing || !isBoardVisible()) return;
    if (document.querySelector('.modal.is-open')) return;

    // 1-6 send a mark without going near the tray, which is the whole point of
    // them: reacting should cost less than a turn does
    if (/^[1-6]$/.test(event.key)) {
        event.preventDefault();
        sendReaction(REACTIONS[Number(event.key) - 1].id);
        return;
    }

    const key = event.key.toUpperCase();
    if (key === 'P' && !el.playBtn.disabled) {
        event.preventDefault();
        el.playBtn.click();
    } else if (key === 'L' && !el.liarBtn.disabled) {
        event.preventDefault();
        el.liarBtn.click();
    } else if (key === 'G') {
        event.preventDefault();
        toggleLog();
    }
});

/* ------------------------------------------------------------------ */
/* resize                                                              */
/* ------------------------------------------------------------------ */

let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        if (isBoardVisible()) refreshBoard();
    }, 180);
});

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

connectServer();
initTopbar();
initReactions();
initLobby();
showLobby();
