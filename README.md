# E-Money's Bar

A high-stakes bluffing game for 2-4 players: standard playing cards, one shared
table suit, and a six-chamber revolver holding a single live round. Play cards
face down and claim they're the table suit. Lie as much as you like: but if
somebody calls "LIAR!", the cards get flipped and one of you spins the cylinder.

Last player breathing wins.

## Running it

The game is a static site with **no build step**, but it does use ES modules, so
it has to be served over HTTP: opening `index.html` off the filesystem will not
work (module scripts are blocked by `file://` CORS).

```bash
python tools/devserver.py
```

Then open <http://localhost:5180>. That's `http.server` with caching turned off.
Plain `python -m http.server` answers with `304 Not Modified`, so an edited
stylesheet or module keeps serving the old copy and it looks like your change
did nothing. `.claude/launch.json` runs the same command.

Multiplayer runs through a Socket.IO relay at `quicklash-server.onrender.com`
(set in `src/constants.js`). It's a free instance, so the first connection of the
day can take up to a minute to wake up: the status pill in the corner tells you
where it's at.

## How it's wired

There is no server-side game logic. Whoever creates the room becomes the
**host** and owns the authoritative state; everyone else mirrors what the host
broadcasts. The relay just forwards messages. That means all players need to be
on the same version of the page.

```
index.html          markup shell + shared SVG defs (card gradients, patterns)
styles/
  tokens.css        inks, rules, hatching, spacing, type: the design system
  base.css          reset, buttons, inputs, panels, scrollbars
  effects.css       plate tone, paper grain, plate mark, shake, struck type
  lobby.css         the struck sign + front-of-house panel
  board.css         HUD, table, dock, action bar, game log
  cards.css         playing cards and the fanned hand
  players.css       seats, avatars, revolver chambers, tooltips
  modals.css        dialogs, revolver stage, toasts, server pill
  responsive.css    desktop-first; everything below adapts down
src/
  constants.js      tunables: deck, seat layouts, timings, server URL
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
  audio.js          every sound, synthesised with WebAudio: no asset files
  fx.js             particles, screen shake, colour flashes
  toast.js          notices and the confirm dialog
  log.js            the game log panel
  icons.js          engraved line icons (symbols live in index.html)
  topbar.js         the floating controls (back, sound, rules, log)
tools/
  devserver.py      no-cache static server for local development
  lobby.js          name entry, hosting, joining, table options
  main.js           boot and global wiring
```

Circular imports between `net`/`game`/`ui` are intentional and safe: every
cross-module call happens at runtime against a hoisted function declaration.

## The look, and the rules it follows

**Engraved letterpress.** The whole interface is one printed plate: gold
linework struck into near-black, shaded with hatching. Five constraints keep it
from drifting into generic-web-app territory. If you're adding UI, hold to them.

- **Nothing is filled that could be drawn.** Depth comes from line weight and
  hatch density, never from a gradient. The table is the clearest example: four
  concentric rules whose weight steps down as you move inward, which is what
  makes it read as dished.
- **No blends.** There is not one soft gradient in `styles/`. Hatching uses
  `repeating-linear-gradient` and stipple uses `radial-gradient`, but both have
  hard stops only, so they are patterns rather than blends. Use the
  `--hatch`, `--hatch-fine`, `--hatch-cross` and `--stipple` tokens rather than
  writing new ones, or the angles stop agreeing with each other.
- **No blur and no glow.** No `backdrop-filter`, no `filter: blur()`, no glowing
  `box-shadow`. State changes are shown by a rule getting heavier or a fill
  being inked in, never by something lighting up. The single exception is
  `.revolver-flash__core`, which is an actual muzzle flash on screen for 300ms.
- **Three line weights, no more.** `--rule-faint`, `--rule`, `--rule-strong`.
  Everything drawn on the plate uses one of them; that shared vocabulary is what
  makes the linework read as one engraving instead of a pile of borders.
- **No emoji.** Every mark is an SVG `<symbol>` in `index.html`, drawn with
  mitred joins and butt caps. Add one there, then use it via `icon('name')` from
  `src/icons.js`. The only non-Latin characters allowed in the UI are the four
  card pips.

Type does real work here. `--font-engraved` (Playfair) carries the engraved
voice: titles, room codes, monograms, numerals. Inter is for body copy, Bebas
for the few big display moments. Gold is for headings, labels and accents only.
Body copy stays bone (`--text`), because gold body text at 14px on near-black is
exactly where this style falls apart.

Corners are square. `--r-sm`/`--r-md`/`--r-lg` are all `0`. The only exceptions
are things that are round in life: `--r-card` (5px), revolver chambers, and the
table.

## Notes for future changes

- **Adding a sound**: add a method to `sfx` in `audio.js`. It composes from two
  primitives, `noise()` and `tone()`. Mute state persists in `localStorage`.
- **Retiming the roulette**: the beat sheet is at the top of `roulette.js`. If
  you make it longer, raise `ROULETTE_RESOLVE_MS` in `constants.js` to match,
  since that's how long the host waits before dealing the next round.
- **Moving seats**: `SEAT_LAYOUTS` in `constants.js` is percentages of the table
  area. On phones a media query overrides it into a flat row across the top.
- **Scale**: the base sizes in `tokens.css` target a desktop monitor.
  `responsive.css` only ever steps *down* from there: width breakpoints trim the
  chrome, height breakpoints shrink the cards, since the board is bound by height
  rather than width. The table is sized from the play area's height with
  `max-height` + a fixed `aspect-ratio`, so it can't grow into the seats above it
  on a short screen.
- **Struck outlines can overflow, inset rules can't.** The doubled rule around a
  control is drawn with `outline` + `outline-offset` on the floating controls
  (which clip nothing) but with an inset `::after` on `.btn`. Buttons live inside
  `.lobby-step`, which is `overflow: auto`, and an outset outline there is enough
  to trip a scrollbar on a page that is otherwise exactly the height of the
  window. Use the inset form anywhere inside a scroll container.
- **`#topbar` is not a bar.** It's a row of controls positioned absolutely
  *over* whatever screen is showing: no border, no solid fill, no layout
  height, and since the plate behind it is flat ink, no scrim either. The
  container is `pointer-events: none` so the strip can't swallow clicks; only
  the controls themselves are `auto`. Screens reserve their own headroom
  (`padding-top` on
  `#screen-game`, on `.lobby-step`) rather than the controls pushing them down.
  If you add a control, put it in a `.topbar__side` so it inherits that.
- **Lobby steps**: `#lobby-menu` → `#lobby-join` → `#lobby-table`, switched by
  `goToStep()` in `lobby.js`. Only one is mounted at a time, so nothing from an
  earlier step (the name field in particular) can linger. Each step titles
  itself; `main.js` owns what "back" means on each screen via `onBack()`.
- **`#screen-lobby` must not be given `position` of its own.** `.screen` already
  makes it `absolute; inset: 0`, and the steps size against that: an ID rule
  would out-specify it and collapse them to zero height.
- **The table** is sized from the play area's *height*, with the width derived
  by `aspect-ratio`. Do not switch it to `max-height` + `aspect-ratio`: that
  clamps the height while the width keeps its own value, which squashes the
  ellipse.
- **The revolver spin** uses `element.animate()`, not a CSS transition. A
  transition needs the browser to have computed the "before" value in an earlier
  frame; when timers coalesce, the set lands in the same frame as the insert and
  the cylinder jumps straight to its final angle without spinning.
- **The hand fan** pivots at `transform-origin: 50% 100%` and reserves
  `--fan-swing` below itself. A pivot below the card (the old `145%`) swings the
  outer cards down onto the Play / Liar buttons.
- **The turn timer** is a square path, not a circle: `M20 3 H37 V37 H3 V3 H20`,
  perimeter 136. If you resize it, update `ARC_LENGTH` in `timer.js` and
  `stroke-dasharray` in `board.css` to match, or the countdown will desync.
- **Background tabs**: `requestAnimationFrame`, CSS animations, and transitions
  are all suspended while a tab is hidden. Anything whose *cleanup* depends on
  them needs a `setTimeout` fallback: see the turn countdown, `fx.flash()`, and
  toast removal.

## Keyboard

| Key | Action |
| --- | --- |
| `P` | Play the selected cards |
| `L` | Call LIAR |
| `G` | Toggle the game log |
| `Esc` | Close the top dialog |
