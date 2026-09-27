# E-Money's Bar

A high-stakes bluffing game for 2-8 players: standard playing cards, one shared
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
day can take up to a minute to wake up. An inline `fetch` in `<head>` knocks on
the relay before the module graph has even been fetched, which takes a bite out
of that; the status pill in the corner tells you where the rest of it is at.

## How it's wired

There is no server-side game logic. Whoever creates the room becomes the
**host** and owns the authoritative state; everyone else mirrors what the host
broadcasts. The relay just forwards messages.

### What the relay does not do

Most of `net.js` is the consequences of three gaps, all of which bite hardest on
phones, and all of which have to be covered client-side:

- **It never reports a disconnect.** Not to the host when a player drops, not to
  the room when the host does. Nobody is ever told that anybody left.
- **A reconnected socket loses its room membership.** It comes back with a new
  id and can still *send* — `client_send` and `host_broadcast` route on the room
  code in the payload — but it no longer *receives*. The game does not look
  broken at that point. It looks quiet.
- **`join_room` aimed at a room whose host socket has gone stale is dropped
  silently.** No ack, no error, no host.

So the transport is treated as unreliable in both directions:

| Piece | What it does |
| --- | --- |
| **Stable keys** | `player.id` is a key minted into `sessionStorage` (`MY_KEY` in `state.js`), never `socket.id`. A reconnect changes the address, not the identity. |
| **Handshake** | Joining is `join_room` (for membership) *plus* a `HELLO` carrying the key and `PROTOCOL_VERSION` (for identity), retried until the host answers `WELCOME`. `player_joined` is only a nudge. |
| **Host reclaim** | On reconnect the host re-emits `create_room`, which re-registers it as the room's host. Without this every client action is routed to a socket that no longer exists. |
| **Heartbeat** | Clients `PING` every 3s; the host `PULSE`s the room. Both ends time each other out. |
| **`stateVersion`** | Every broadcast is numbered and the number rides on the pulse, so a client that missed an update notices within one beat and sends `REQUEST_SYNC` instead of drawing a stale board. |
| **Away vs gone** | Silence marks a seat *away* — dimmed, but the hand and the seat are held. Only two minutes of it (or pressing leave) ends anyone's game. |
| **Outbox** | Plays and calls made while the socket is down are queued and flushed on reconnect; heartbeats and reactions are dropped, being worthless late. |
| **Turn epoch** | Actions carry the turn they were decided on, so a queued play can't be applied to a hand that has since been dealt away. |
| **Replayed ending** | `GAME_OVER` is one broadcast, and one broadcast is what a phone misses. The host keeps the last one and hands it back on any handshake or resync, so nobody reconnects into a dead board with no result and no rematch button. |
| **Freeze credit** | Every timeout here is measured against the wall clock, which keeps running while a suspended page does not. A tick that finds a gap far wider than the tick interval pushes those clocks forward by it — see below. |

All players still need to be on the same build: the host checks
`PROTOCOL_VERSION` on the handshake and turns away anything it can't talk to
with a message that says to reload. Bump it in `constants.js` whenever the wire
format changes.

The one failure that is still fatal is the host actually leaving — closing the
tab, or reloading it. Clients wait out `HOST_LOST_MS` (five minutes of genuine
silence) and then go back to the lobby, because the host holds every hand and
every revolver and there is nowhere for that state to have been kept. Host
migration would need the host to be shipping a full snapshot to a designated
successor on every turn.

The relay also does not check who is talking: `host_broadcast` is available to
any socket that knows the room code, so a client running a modified page could
speak as the host. Nothing here defends against that, and nothing can without
server-side changes — the relay strips any sense of who sent a `game_data`
message before it arrives. It is a five-character code shared out loud between
friends, and the threat model is treated accordingly.

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
  reactions.css     the bell, its tray, and the marks it throws
  modals.css        dialogs, revolver stage, the ledger, toasts, server pill
  responsive.css    desktop-first; everything below adapts down
src/
  constants.js      tunables: deck, seat layouts, timings, server URL
  state.js          the three shared objects: localPlayer, gameState, session
  dom.js            cached element refs + modal open/close
  net.js            transport, handshake, heartbeat, reconnection ← the wire lives here
  game.js           host-only: deck, turns, roulette, ledger, away/gone  ← rules live here
  ui.js             screen transitions, the ledger, handlers shared by host and client
  board.js          table centre, turn indicator, action bar
  hand.js           your cards: the fan, the picking
  seats.js          opponents around the table
  cards.js          card rendering and the card-flight animation
  roulette.js       the cinematic revolver
  reactions.js      the six marks players can throw at each other
  timer.js          turn clock (visual countdown + host enforcement)
  audio.js          every sound, synthesised with WebAudio: no asset files
  fx.js             particles, screen shake, colour flashes
  toast.js          notices and the confirm dialog
  log.js            the game log panel
  icons.js          engraved line icons (symbols live in index.html)
  topbar.js         the floating controls (back, bell, sound, rules, log)
  lobby.js          name entry, hosting, joining, table options
  main.js           boot and global wiring
tools/
  devserver.py      no-cache static server for local development
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
- **Every sound is a one-shot.** There is no bed, no loop and nothing running
  between events, which is what lets the whole sound board be a set of pure
  functions over `noise()` and `tone()` with no state to start, stop or duck. If
  you add something continuous, it needs its own gain node and a
  `visibilitychange` handler: WebAudio keeps running in a background tab, and a
  one-shot firing there is fine where a loop is not.
- **Effects always animate.** There is no motion preference, no toggle and no
  `prefers-reduced-motion` gate: `fx.js`, `cards.js`, `roulette.js` and
  `reactions.css` all run unconditionally. This is a deliberate choice against
  the grain of the platform — the media query exists because motion makes some
  people ill — so if it is ever revisited, the thing to restore is the media
  query, not just the button.
- **Reactions go through the host, always.** A client sends `PLAYER_REACTION`
  and the host validates the mark, enforces a per-sender cooldown and
  re-broadcasts `REACTION`. The sender draws its own mark on the way out and
  `showReaction` drops anything addressed to us on the way back, because
  `host_broadcast` reaches the room the sender is also in. Adding a mark means
  adding a `<symbol id="i-rx-…">`, an entry in `REACTIONS`, and a case in
  `sfx.reaction()`; the array order is also the number key that sends it.
- **Who may call LIAR is one predicate.** `canCallLiar()` in `state.js` is what
  the host validates a call with and what enables the button on every client.
  With the host's *open calls* option on, anyone still in except the accused can
  call the last play; the first call to reach the host flips the phase and any
  others fall through. A call carries the `turnEpoch` it was made on, so one
  held up by the confirm dialog cannot land on a later play.
- **The ledger is host-only and rides on `GAME_OVER`.** `gameState.stats` grows
  with every play and nobody reads it until the game ends, so it is deliberately
  not in `broadcastState`. It records counters and never a card: a ledger that
  could reconstruct a hand would turn the log panel into an oracle. Honours are
  computed on each client from the same numbers, so there is one implementation
  of the wording rather than two.
- **The game-over dialog is a flex column.** Eight players and three honours is
  taller than a 720px laptop. The ledger's table is the flexible part, honours
  are dropped by height breakpoint in `responsive.css`, and the rule that has to
  hold is that the rematch button is never pushed below the fold.
- **The prewarm URL is duplicated.** The inline `<head>` script in `index.html`
  hardcodes the relay, because its whole purpose is to fire before any module
  has loaded and it therefore cannot import `SERVER_URL`. `src/constants.js` is
  still the source of truth; move the server and you must move both. It knocks
  on the socket.io handshake path rather than `/`, which serves nothing and
  would log a 404 before the page has drawn a pixel.
- **Retiming the roulette**: the beat sheet is at the top of `roulette.js`, but
  the timings live in `planRoulette()` in `constants.js`, and that is the only
  place to change them. The host waits `plan.totalMs` before dealing the next
  round, so the animation and the pacing cannot drift apart.
- **The roulette is planned, not improvised.** The hold before the trigger is
  2 to 5 seconds and the landing chamber is random, so both are derived from a
  single `rouletteSeed` the host puts in the payload. Never reach for
  `Math.random()` inside `roulette.js`: every client has to run the identical
  sequence, or players see different guns and the host cuts the ending short
  for everyone but itself.
- **The cylinder indexes, it does not spin.** Each revolver is a six-item deck
  that gets popped from, so the odds climb as it empties. A free spin would say
  the opposite (that every shot is a fresh 1-in-6), which is why it advances a
  notch at a time instead. Spent chambers stay struck out and live rounds stay
  drawn, so the table can count what is left; only *which* round is live is
  hidden.
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
- **Never announce a departure on `pagehide`.** It fires on a phone for
  switching apps, locking the screen and pulling down the notification shade,
  none of which are leaving. It used to, and a host who glanced at a text
  message sent the whole table back to the lobby. The two mistakes are not
  symmetrical: announcing a departure that did not happen ends everyone's game
  and cannot be taken back, while missing one that did costs a couple of minutes
  of a struck-through seat that the heartbeat sweep clears up on its own. So
  `beforeunload` announces and `pagehide` does not; `pageshow`,
  `visibilitychange` and `online` all call `resumeNetwork()`.
- **Timers do not run in a backgrounded tab**, which matters most on the host,
  because every play goes through it. The turn clock is therefore a watchdog on
  a 500ms tick rather than one long `setTimeout`, and it measures the gap
  between its own ticks: a gap much wider than the tick was a freeze, and the
  deadline moves forward by it rather than being spent on a turn nobody at the
  table could have taken. On the client side `syncCountdown()` re-seats the arc
  whenever it drifts from the host's `turnRemainingMs`, since a resumed tab's
  `performance.now()` has moved on without it.
- **Anything that advances game state on a delay needs `afterHostDelay()`, not
  `setTimeout`.** There is exactly one such hand-off — the wait after the
  roulette before the next round is dealt — and it is the worst moment in the
  game to be frozen at, because the shot is on screen, nobody is touching
  anything, and the turn timer is disarmed for the duration. A plain timeout
  that does not fire there leaves the entire table sitting in
  `roulette_resolved` on a spent cylinder with nothing left running to notice.
  `afterHostDelay` keeps the exact timing and puts a watchdog behind it.
- **A freeze must be credited back to every wall-clock timeout, not just the
  turn clock.** This is the same hazard one level up: on resume, `netTick`
  evaluates every liveness timeout at once against a clock that ran on without
  it. Uncredited, a client concludes the host has been silent for the whole
  three minutes and quits to the lobby in the frame the screen lights up — and
  a *host* concludes that all eight players have been silent for three minutes
  and eliminates the entire table. `creditFreeze()` in `net.js` pushes
  `lastHostBeat` and every `lastSeen` forward by the gap, so those clocks hold
  what they held going in and start running again from the moment somebody was
  there to hear them.

## Keyboard

| Key | Action |
| --- | --- |
| `P` | Play the selected cards |
| `L` | Call LIAR |
| `G` | Toggle the game log |
| `1`–`6` | Throw a reaction, without opening the tray |
| `Esc` | Close the top dialog |
