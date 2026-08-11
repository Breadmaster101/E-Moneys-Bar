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

/* ------------------------------------------------------------------ */
/* the roulette, planned up front                                      */
/* ------------------------------------------------------------------ */

/** Beats either side of the variable part of the sequence. */
export const ROULETTE_LEAD_IN_MS = 260;   // modal open, cards flip, before the first notch
export const ROULETTE_TAIL_MS = 1150;     // strike, result text, a beat to read it

/**
 * One chamber turning over. Deliberately constant rather than running down
 * like a real cylinder: an even, unhurried tick gives away nothing about how
 * close the sequence is to stopping, so the tension holds all the way through.
 */
export const ROULETTE_NOTCH_MS = 500;

/** How long the cylinder sits on the chosen chamber before the trigger. */
export const ROULETTE_HOLD_MIN_MS = 2000;
export const ROULETTE_HOLD_MAX_MS = 5000;

/** Small deterministic PRNG (mulberry32), so a seed gives everyone the same run. */
function rngFrom(seed) {
    let t = (Math.imul(seed | 0, 0x9e3779b9) ^ 0x85ebca6b) >>> 0;
    return () => {
        t = (t + 0x6d2b79f5) >>> 0;
        let x = Math.imul(t ^ (t >>> 15), 1 | t);
        x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
        return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Work out the whole roulette sequence from a seed the host broadcasts.
 *
 * This is pure and lives here, at the bottom of the dependency graph, because
 * two very different callers need the identical answer: `roulette.js` plays the
 * sequence, and `game.js` has to know exactly how long it runs so the host
 * doesn't deal the next round over the top of it. Deriving the hold from a
 * shared seed rather than calling Math.random() per client is what keeps those
 * two in step, and keeps every player watching the same gun.
 *
 * Chambers are numbered clockwise from the index mark at twelve o'clock. Spent
 * ones are the low indices, so the live rounds are always `spentCount`..5.
 *
 * @param {object}  opts
 * @param {number}  opts.seed            integer from the host
 * @param {number}  opts.chambersBefore  live rounds left *before* this shot
 */
export function planRoulette({ seed = 0, chambersBefore = REVOLVER_CHAMBERS } = {}) {
    const live = Math.min(Math.max(chambersBefore, 1), REVOLVER_CHAMBERS);
    const spentCount = REVOLVER_CHAMBERS - live;
    const rand = rngFrom(seed);

    // land on a chamber that still holds a round
    const landingChamber = spentCount + Math.floor(rand() * live);

    /** 1 turns the cylinder clockwise, -1 anticlockwise. */
    const direction = rand() < 0.5 ? 1 : -1;

    /*
     * At least one full revolution, then however much further it takes to bring
     * the chosen chamber under the mark.
     *
     * Turning clockwise, one notch moves the chamber at the mark from i to i-1,
     * so N notches puts chamber (-N mod 6) on top. Anticlockwise it runs the
     * other way and N notches puts chamber (N mod 6) on top. Get this wrong and
     * the cylinder stops on a chamber that has already been fired.
     */
    const notches = REVOLVER_CHAMBERS + (direction === 1
        ? ((REVOLVER_CHAMBERS - landingChamber) % REVOLVER_CHAMBERS)
        : (landingChamber % REVOLVER_CHAMBERS));

    // every notch the same length: see ROULETTE_NOTCH_MS
    const notchDurations = new Array(notches).fill(ROULETTE_NOTCH_MS);

    const spinMs = notchDurations.reduce((a, b) => a + b, 0);
    const holdMs = Math.round(
        ROULETTE_HOLD_MIN_MS + rand() * (ROULETTE_HOLD_MAX_MS - ROULETTE_HOLD_MIN_MS),
    );

    return {
        spentCount,
        landingChamber,
        direction,
        notchDurations,
        spinMs,
        holdMs,
        fireAt: ROULETTE_LEAD_IN_MS + spinMs + holdMs,
        totalMs: ROULETTE_LEAD_IN_MS + spinMs + holdMs + ROULETTE_TAIL_MS,
    };
}

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
