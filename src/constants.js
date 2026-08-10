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
 * Where opponents sit, keyed by opponent count.
 *
 * These are percentages of the *table box*, not of the play area, which is why
 * they run outside 0-100: #seats is sized and positioned to match #table
 * exactly (see board.css), so a seat at x: -8 sits just off the table's left
 * edge no matter how big the table is. Positioning them against the play area
 * instead put the side seats out by the screen edges, because the table only
 * occupies the middle third of it.
 *
 * Every point below is one of the eight on the ring shared with the waiting
 * room: an ellipse at cx/cy 50, rx 58, ry 54, sampled every 45 degrees. The
 * bottom point is left out because that is where you sit. Order runs clockwise
 * starting to your left, matching the order renderSeats() hands them out in.
 *
 * Keep these in step with WAIT_SLOTS in lobby.js: the lobby ring is the
 * preview of this one, and they are meant to read as the same table.
 */
const RING = {
    left: { x: -8, y: 50 },
    upperLeft: { x: 9, y: 12 },
    // anchorTop: sit fully above this point rather than centred on it. Every
    // other slot is beside the table, where hanging over the felt's empty
    // corner is fine, but the top slot hangs straight down onto the suit
    // medallion. How far down depends on the plate's height and the table's
    // size, so centring it can only ever be tuned per breakpoint; anchoring
    // it is correct at every size.
    top: { x: 50, y: -4, anchorTop: true },
    upperRight: { x: 91, y: 12 },
    right: { x: 108, y: 50 },
    lowerRight: { x: 91, y: 88 },
    lowerLeft: { x: 9, y: 88 },
};

export const SEAT_LAYOUTS = {
    1: [RING.top],
    2: [RING.upperLeft, RING.upperRight],
    3: [RING.left, RING.top, RING.right],
    4: [RING.left, RING.upperLeft, RING.upperRight, RING.right],
    5: [RING.left, RING.upperLeft, RING.top, RING.upperRight, RING.right],
    6: [
        RING.lowerLeft, RING.left, RING.upperLeft,
        RING.upperRight, RING.right, RING.lowerRight,
    ],
    7: [
        RING.lowerLeft, RING.left, RING.upperLeft, RING.top,
        RING.upperRight, RING.right, RING.lowerRight,
    ],
};
