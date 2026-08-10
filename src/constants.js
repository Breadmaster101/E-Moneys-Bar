/**
 * Game-wide constants. No imports: this is the bottom of the dependency graph.
 */

export const SERVER_URL = 'https://quicklash-server.onrender.com';

/*
 * 8 players deal 40 of the 52 cards, so a round still fits in one deck.
 * Raising this further would not: at 10 the deal would run the deck dry and
 * players would silently receive short hands.
 */
export const MAX_PLAYERS = 8;
export const MIN_PLAYERS = 2;
export const HAND_SIZE = 5;
export const MAX_CARDS_PER_PLAY = 3;
export const ROOM_CODE_LENGTH = 5;
export const NAME_MIN = 3;
export const NAME_MAX = 14;

export const SUITS = ['H', 'D', 'C', 'S'];
export const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

export const SUIT_SYMBOLS = { H: '♥', D: '♦', C: '♣', S: '♠' };
export const SUIT_NAMES = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };
export const SUIT_IS_RED = { H: true, D: true, C: false, S: false };

export const REVOLVER_CHAMBERS = 6;
export const REVOLVER_BULLETS = 1;

/**
 * Per-seat accent colours, assigned in join order, as printed inks. These must
 * stay in step with --p1 to --p8 in tokens.css: the tokens document the
 * palette, but it is these values that get written into --seat-color inline,
 * so they are the ones that actually show.
 *
 * There must be at least MAX_PLAYERS of them. colorFor() wraps with a modulo,
 * so a short list means two players silently share an accent.
 */
export const PLAYER_COLORS = [
    '#c9a961', // gold
    '#6f8f9e', // steel
    '#b0616d', // rose
    '#8a9c63', // olive
    '#a98cb0', // mauve
    '#c08552', // sienna
    '#7fa3a0', // verdigris
    '#b8a06a', // buff
];

/** How long the host waits after a roulette before dealing the next round. */
export const ROULETTE_RESOLVE_MS = 4600;

/** Turn timer choices offered to the host (0 = off). */
export const TURN_TIMER_OPTIONS = [0, 20, 30, 45];
export const DEFAULT_TURN_SECONDS = 30;

/**
 * Where opponents sit, as % of the table area. Index = opponent count.
 * Kept clear of the table ellipse (which starts around 24% and is centred
 * at 52-54%) so name plates never sit on top of the suit medallion.
 */
export const SEAT_LAYOUTS = {
    1: [{ x: 50, y: 16 }],
    2: [{ x: 16, y: 34 }, { x: 84, y: 34 }],
    3: [{ x: 13, y: 44 }, { x: 50, y: 16 }, { x: 87, y: 44 }],
    4: [{ x: 11, y: 46 }, { x: 33, y: 15 }, { x: 67, y: 15 }, { x: 89, y: 46 }],
    5: [{ x: 9, y: 48 }, { x: 22, y: 18 }, { x: 50, y: 12 }, { x: 78, y: 18 }, { x: 91, y: 48 }],
    6: [
        { x: 8, y: 50 }, { x: 15, y: 24 }, { x: 36, y: 13 },
        { x: 64, y: 13 }, { x: 85, y: 24 }, { x: 92, y: 50 },
    ],
    7: [
        { x: 8, y: 52 }, { x: 12, y: 28 }, { x: 29, y: 14 }, { x: 50, y: 10 },
        { x: 71, y: 14 }, { x: 88, y: 28 }, { x: 92, y: 52 },
    ],
};
