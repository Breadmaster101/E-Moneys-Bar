/**
 * Game-wide constants. No imports — this is the bottom of the dependency graph.
 */

export const SERVER_URL = 'https://quicklash-server.onrender.com';

export const MAX_PLAYERS = 4;
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

/** Per-seat accent colours, assigned in join order. */
export const PLAYER_COLORS = ['#ffb44d', '#4fe3ff', '#ff5f9e', '#7bea6a'];

/** How long the host waits after a roulette before dealing the next round. */
export const ROULETTE_RESOLVE_MS = 4600;

/** Turn timer choices offered to the host (0 = off). */
export const TURN_TIMER_OPTIONS = [0, 20, 30, 45];
export const DEFAULT_TURN_SECONDS = 30;

/**
 * Where opponents sit, as % of the table area. Index = opponent count.
 * Kept clear of the table ellipse (which starts around 24% and is centred
 * at 52–54%) so name plates never sit on top of the suit medallion.
 */
export const SEAT_LAYOUTS = {
    1: [{ x: 50, y: 14 }],
    2: [{ x: 16, y: 34 }, { x: 84, y: 34 }],
    3: [{ x: 13, y: 44 }, { x: 50, y: 14 }, { x: 87, y: 44 }],
};
