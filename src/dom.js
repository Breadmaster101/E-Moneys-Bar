/**
 * Cached element references. `main.js` is a module (deferred), so the DOM is
 * fully parsed by the time any of this evaluates.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export const el = {
    // screens
    lobby: $('#screen-lobby'),
    game: $('#screen-game'),

    // lobby steps
    stepMenu: $('#lobby-menu'),
    stepJoin: $('#lobby-join'),
    stepTable: $('#lobby-table'),

    // step 1: menu
    nameInput: $('#playerNameInput'),
    nameHint: $('#nameHint'),
    createRoomBtn: $('#createRoomBtn'),
    joinRoomBtn: $('#joinRoomBtn'),
    marqueeBulbs: $('.marquee-bulbs'),

    // step 2: join
    roomCodeInput: $('#roomCodeInput'),
    connectBtn: $('#connectToHostBtn'),
    clientStatus: $('#client-status'),

    // step 3: waiting room
    roomCodeDisplay: $('#roomCodeDisplay'),
    copyRoomCodeBtn: $('#copyRoomCodeBtn'),
    turnTimerRow: $('#turnTimerRow'),
    turnTimerSeg: $('#turnTimerSeg'),
    waitroomSeats: $('#waitroom-seats'),
    waitroomTitle: $('#waitroomTitle'),
    waitroomSub: $('#waitroomSub'),
    playersCount: $('#connected-players-count'),
    startGameBtn: $('#startGameBtn'),
    startHint: $('#startHint'),

    // top bar
    topbar: $('#topbar'),
    backBtn: $('#backBtn'),
    soundToggleBtn: $('#soundToggleBtn'),
    soundIconUse: $('#soundIconUse'),
    rulesBtnGame: $('#rulesBtnGame'),
    logToggleBtn: $('#logToggleBtn'),
    reactionWrap: $('#reactionWrap'),
    reactionBtn: $('#reactionBtn'),
    reactionTray: $('#reaction-tray'),
    turnPill: $('#turn-pill'),
    turnPillAvatar: $('#turn-pill-avatar'),
    turnPillText: $('#turn-pill-text'),
    turnTimerArc: $('#turnTimerArc'),

    // board
    tableArea: $('#table-area'),
    seats: $('#seats'),
    table: $('#table'),
    suitMedallion: $('#suit-medallion'),
    suitGlyph: $('#suit-medallion-glyph'),
    suitName: $('#suit-medallion-name'),
    pile: $('#pile'),
    lastPlay: $('#last-play'),

    // dock
    dock: $('#dock'),
    selfPlate: $('#self-plate'),
    hand: $('#hand'),
    playBtn: $('#playCardsBtn'),
    liarBtn: $('#callLiarBtn'),
    selectCounter: $('#select-counter'),

    // log
    logPanel: $('#log-panel'),
    logMessages: $('#log-messages'),
    logCloseBtn: $('#logCloseBtn'),

    // announcement
    turnAnnounce: $('#turn-announce'),
    reactionLayer: $('#reaction-layer'),

    // roulette modal
    rouletteModal: $('#modal-roulette'),
    rouletteTitle: $('#rouletteTitle'),
    rouletteDetails: $('#rouletteDetails'),
    revealedCards: $('#revealed-cards'),
    rouletteConsequence: $('#rouletteConsequence'),
    revolverStage: $('#revolver-stage'),
    rouletteResult: $('#rouletteResult'),
    continueBtn: $('#continueGameBtn'),

    // game over modal
    gameOverModal: $('#modal-gameover'),
    gameOverOrnament: $('#gameOverOrnament'),
    gameOverTitle: $('#gameOverTitle'),
    gameOverMessage: $('#gameOverMessage'),
    ledger: $('#game-ledger'),
    ledgerRounds: $('#ledgerRounds'),
    ledgerHonours: $('#ledgerHonours'),
    ledgerRows: $('#ledgerRows'),
    rematchStatus: $('#rematch-status'),
    rematchList: $('#rematch-status-list'),
    playAgainBtn: $('#playAgainBtn'),
    exitGameBtn: $('#exitGameBtn'),

    // rules modal
    rulesModal: $('#modal-rules'),
    closeRulesBtn: $('#closeRulesBtn'),

    // confirm modal
    confirmModal: $('#modal-confirm'),
    confirmTitle: $('#confirmTitle'),
    confirmMessage: $('#confirmMessage'),
    confirmOkBtn: $('#confirmOkBtn'),
    confirmCancelBtn: $('#confirmCancelBtn'),

    // transient
    toastStack: $('#toast-stack'),
    serverStatus: $('#server-status'),
    serverStatusText: $('#server-status-text'),
    fxCanvas: $('#fx-canvas'),
    fxFlash: $('#fx-flash'),
    fxBlood: $('#fx-blood'),
};

/** Show/hide a modal with its transition. Returns nothing. */
const modalTimers = new WeakMap();

/** How long the close transition runs before the modal leaves the layout. */
export const MODAL_CLOSE_MS = 280;

export function openModal(modal) {
    clearTimeout(modalTimers.get(modal));
    modal.classList.add('is-open');
    // let the browser register the closed state so the transition has a start
    // point (setTimeout, not rAF, because rAF never fires in a backgrounded tab)
    modalTimers.set(modal, setTimeout(() => modal.classList.add('is-visible'), 16));
}

export function closeModal(modal) {
    if (!modal.classList.contains('is-open')) return;
    modal.classList.remove('is-visible');
    modalTimers.set(
        modal,
        setTimeout(() => modal.classList.remove('is-open'), MODAL_CLOSE_MS),
    );
}

export const isModalOpen = (modal) => modal.classList.contains('is-open');

export const anyModalOpen = () => !!document.querySelector('.modal.is-open');
