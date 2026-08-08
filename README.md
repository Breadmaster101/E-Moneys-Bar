# E-Money's Bar

A high-stakes bluffing game for 2–4 players: standard playing cards, one shared
table suit, and a six-chamber revolver holding a single live round. Play cards
face down and claim they're the table suit. Lie as much as you like — but if
somebody calls "LIAR!", the cards get flipped and one of you spins the cylinder.

Last player breathing wins.

## Running it

The game is a static site with **no build step**, but it does use ES modules, so
it has to be served over HTTP — opening `index.html` off the filesystem will not
work (module scripts are blocked by `file://` CORS).

```bash
python -m http.server 5173
```

Then open <http://localhost:5173>. There's also a `.claude/launch.json` wired up
for the same thing.

Multiplayer runs through a Socket.IO relay at `quicklash-server.onrender.com`
(set in `src/constants.js`). It's a free instance, so the first connection of the
day can take up to a minute to wake up — the status pill in the corner tells you
where it's at.

## How it's wired

There is no server-side game logic. Whoever creates the room becomes the
**host** and owns the authoritative state; everyone else mirrors what the host
broadcasts. The relay just forwards messages. That means all players need to be
on the same version of the page.

```
index.html          markup shell + shared SVG defs (card gradients, patterns)
styles/
  tokens.css        colours, spacing, type, motion — the whole design system
  base.css          reset, buttons, inputs, panels, scrollbars
  effects.css       room lighting, film grain, vignette, shake, neon flicker
  lobby.css         marquee sign + front-of-house panel
  board.css         HUD, table, dock, action bar, game log
  cards.css         playing cards and the fanned hand
  players.css       seats, avatars, revolver chambers, tooltips
  modals.css        dialogs, revolver stage, toasts, server pill
  responsive.css    desktop-first; everything below adapts down
src/
  constants.js      tunables — deck, seat layouts, timings, server URL
  state.js          the three shared objects: localPlayer, gameState, session
  dom.js            cached element refs + modal open/close
  net.js            Socket.IO transport and message routing
  game.js           host-only: deck, turns, roulette, disconnects  ← rules live here
  ui.js             screen transitions + handlers shared by host and client
  board.js          table centre, turn indicator, action bar
  hand.js           your cards: the fan, the picking
  seats.js          opponents around the table
  cards.js          card rendering and the card-flight animation
  roulette.js       the cinematic revolver
  timer.js          turn clock (visual countdown + host enforcement)
  audio.js          every sound, synthesised with WebAudio — no asset files
  fx.js             particles, screen shake, colour flashes
  toast.js          notices and the confirm dialog
  log.js            the game log panel
  icons.js          engraved line icons (symbols live in index.html)
  lobby.js          name entry, hosting, joining, table options
  main.js           boot and global wiring
```

Circular imports between `net`/`game`/`ui` are intentional and safe — every
cross-module call happens at runtime against a hoisted function declaration.

## The look, and the rules it follows

Neon-noir speakeasy. Three constraints keep it from drifting into
generic-web-app territory — if you're adding UI, hold to them:

- **No emoji.** Every mark is an SVG `<symbol>` in `index.html`, drawn with
  mitred joins and butt caps so it reads as engraved rather than illustrated.
  Add one there, then use it via `icon('name')` from `src/icons.js`. The only
  non-Latin characters allowed in the UI are the four card pips.
- **Near-square corners.** `--r-sm`/`--r-md`/`--r-lg` are 1–3px. The sole
  exception is `--r-card` (5px) because physical playing cards are rounded, plus
  things that are actually circular: revolver chambers and the table.
- **No blur.** There is no `backdrop-filter` anywhere. Surfaces are solid and
  matte, framed by a hairline `outline` set in from the edge (`--frame-inset`,
  `--frame-line`). Shadows are hard and close — objects sitting on a bar top,
  not floating UI layers.

Glow is reserved for things that are literally emitting light: the neon sign,
the room-code plate, the LIAR button, and the muzzle flash.

## Notes for future changes

- **Adding a sound**: add a method to `sfx` in `audio.js`. It composes from two
  primitives, `noise()` and `tone()`. Mute state persists in `localStorage`.
- **Retiming the roulette**: the beat sheet is at the top of `roulette.js`. If
  you make it longer, raise `ROULETTE_RESOLVE_MS` in `constants.js` to match —
  that's how long the host waits before dealing the next round.
- **Moving seats**: `SEAT_LAYOUTS` in `constants.js` is percentages of the table
  area. On phones a media query overrides it into a flat row across the top.
- **Scale**: the base sizes in `tokens.css` target a desktop monitor.
  `responsive.css` only ever steps *down* from there — width breakpoints trim the
  chrome, height breakpoints shrink the cards, since the board is bound by height
  rather than width. The table is sized from the play area's height with
  `max-height` + a fixed `aspect-ratio`, so it can't grow into the seats above it
  on a short screen.
- **The turn timer** is a square path, not a circle: `M20 3 H37 V37 H3 V3 H20`,
  perimeter 136. If you resize it, update `ARC_LENGTH` in `timer.js` and
  `stroke-dasharray` in `board.css` to match, or the countdown will desync.
- **Background tabs**: `requestAnimationFrame`, CSS animations, and transitions
  are all suspended while a tab is hidden. Anything whose *cleanup* depends on
  them needs a `setTimeout` fallback — see the turn countdown, `fx.flash()`, and
  toast removal.

## Keyboard

| Key | Action |
| --- | --- |
| `P` | Play the selected cards |
| `L` | Call LIAR |
| `G` | Toggle the game log |
| `Esc` | Close the top dialog |
