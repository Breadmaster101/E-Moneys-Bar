/**
 * main.js: boot, global wiring, keyboard shortcuts.
 */

import { el, openModal, closeModal, isModalOpen, MODAL_CLOSE_MS } from './dom.js';
import { gameState, localPlayer, session, isMyTurn, amEliminated } from './state.js';
import { connectServer, sendMessage } from './net.js';
import { handlePlayCards, handleCallLiar, handleRematchVote, stopHostTimers } from './game.js';
import { showLobby, refreshBoard, isBoardVisible } from './ui.js';
import { initLobby, goToStep, currentStep } from './lobby.js';
import { initTopbar, onBack } from './topbar.js';
import { updateActions } from './board.js';
import { clearSelection, invalidateHand, animateSelectedOut } from './hand.js';
import { cancelRoulette } from './roulette.js';
import { toggleLog } from './log.js';
import { confirmDialog, isConfirmOpen, dismissConfirm, toast } from './toast.js';
import { unlock as unlockAudio, toggleMute, isMuted, sfx } from './audio.js';
import { reducedMotion, toggleMotion, motionPref, systemPrefersReduced } from './motion.js';
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
/* motion                                                              */
/* ------------------------------------------------------------------ */

function paintMotionButton() {
    const off = reducedMotion();
    setIcon(el.motionIconUse, off ? 'motion-off' : 'motion-on');
    el.motionToggleBtn.classList.toggle('is-off', off);
    el.motionToggleBtn.setAttribute('aria-pressed', String(off));
    el.motionToggleBtn.title = off ? 'Motion off' : 'Motion on';
}

el.motionToggleBtn.addEventListener('click', () => {
    const off = toggleMotion();
    paintMotionButton();
    sfx.tap();
    toast(
        off ? 'Motion off. Effects will not animate.' : 'Motion on. Full effects.',
        { type: off ? 'info' : 'success' },
    );
});
paintMotionButton();

/*
 * Said once, and only to the people it applies to: the machine asked for less
 * motion, the game obliged, and the way back is this button. Without it the
 * revolver fires blank-looking rounds and nothing on screen explains why.
 */
if (motionPref() === 'auto' && systemPrefersReduced()) {
    setTimeout(() => toast(
        'Your system asks for reduced motion, so effects are off. Turn them on here.',
        { type: 'info', duration: 7000 },
    ), 900);
}

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
        sendMessage('PLAYER_ACTION_PLAY_CARDS', { cards: ids });
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
    else sendMessage('PLAYER_ACTION_CALL_LIAR', {});
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

function announceDeparture() {
    if (localPlayer.isHost && Object.keys(session.hostConnections).length > 0) {
        sendMessage('HOST_DISCONNECTED', { message: 'Host left.' });
    } else if (!localPlayer.isHost && session.roomCode) {
        sendMessage('CLIENT_DISCONNECTED', { message: 'Player left.' });
    }
}

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

// beforeunload is unreliable on mobile Safari; pagehide is the one that fires
// there. Both are best-effort: a hard tab close can still cut the socket first.
window.addEventListener('beforeunload', announceDeparture);
window.addEventListener('pagehide', announceDeparture);

/* ------------------------------------------------------------------ */
/* keyboard                                                            */
/* ------------------------------------------------------------------ */

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        if (isConfirmOpen()) { dismissConfirm(); return; }
        if (isModalOpen(el.rulesModal)) { closeModal(el.rulesModal); return; }
        if (el.logPanel.classList.contains('is-open')) { toggleLog(false); return; }
        return;
    }

    const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
    if (typing || !isBoardVisible()) return;
    if (document.querySelector('.modal.is-open')) return;

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
initLobby();
showLobby();
