/**
 * net.js: the Socket.IO relay layer, and everything that holds a table
 * together on top of a relay that will not help.
 *
 * The server is a dumb pipe: one player is the host and owns the truth, every
 * other player mirrors whatever the host broadcasts.
 *
 * The pipe is dumber than it looks, and this file is mostly the consequences.
 * Three things it does not do:
 *
 *   1. It never reports a disconnect. Not to the host when a player goes, not
 *      to the room when the host does. Nobody is ever told that anybody left.
 *   2. A socket that reconnects comes back with a new id and *without* its room
 *      membership. It can still send — `client_send` and `host_broadcast` route
 *      on the room code in the payload — but it no longer receives. The game
 *      does not look broken at that point. It looks quiet.
 *   3. `join_room` addressed to a room whose host socket has gone stale is
 *      dropped on the floor: no ack, no error, no host.
 *
 * So: identity is a key we mint, not the socket id (see state.js); every
 * arrival is a handshake rather than a `player_joined` event; both ends
 * heartbeat and time each other out; and any silence is first assumed to be
 * *our own* membership having lapsed, because it usually is, and re-knocking
 * costs nothing.
 */

import {
    SERVER_URL, SOCKET_OPTIONS, PROTOCOL_VERSION, MAX_PLAYERS, NAME_MAX, REVOLVER_CHAMBERS,
    SUIT_SYMBOLS, HEARTBEAT_MS, AWAY_AFTER_MS, DROP_AFTER_MS_GAME, DROP_AFTER_MS_LOBBY,
    HOST_SILENT_MS, HOST_LOST_MS, REKNOCK_MS, OUTBOX_LIMIT, OUTBOX_STALE_MS,
    FREEZE_GAP_MS,
} from './constants.js';
import { el } from './dom.js';
import { gameState, localPlayer, session, MY_KEY } from './state.js';
import { toast } from './toast.js';
import { addLog } from './log.js';
import { sfx } from './audio.js';
import {
    handlePlayCards,
    handleCallLiar,
    handlePlayerGone,
    handlePlayerBack,
    handleRematchVote,
    handleNameUpdate,
    handleReaction,
    sweepAwayTurn,
    broadcastState,
    stateForClient,
    gameOverPayload,
    pruneConnections,
} from './game.js';
import { showReaction } from './reactions.js';
import {
    showLobby,
    applyRouletteResults,
    showGameOver,
    onClientStateUpdate,
    updateLobbySeats,
} from './ui.js';
import { goToStep } from './lobby.js';

/* ------------------------------------------------------------------ */
/* saying where we are                                                 */
/* ------------------------------------------------------------------ */

/*
 * Two different facts, one pill.
 *
 * `socketUp` is about the wire and `link` is about the table, and they come
 * apart in the case that matters most: a socket that reconnected but has not
 * been re-seated is connected and useless. Both are painted through one
 * function so they cannot disagree on screen, and the table always wins,
 * because "connected" over a game that has stopped updating is a lie.
 */

/** @typedef {'idle'|'connecting'|'live'|'reseating'|'offline'} LinkState */

let link = 'idle';
let socketUp = false;
let hideStatusTimer = null;

function paintStatus() {
    let state = 'connecting';
    let text = 'Waking the server… this can take a minute.';

    if (!socketUp) {
        state = link === 'idle' ? 'connecting' : 'off';
        text = link === 'idle'
            ? 'Waking the server… this can take a minute.'
            : 'Offline. Trying to get back…';
    } else if (link === 'reseating') {
        state = 'warn';
        text = 'Reconnecting to the table…';
    } else {
        state = 'on';
        text = 'Connected';
    }

    clearTimeout(hideStatusTimer);
    el.serverStatus.dataset.state = state;
    el.serverStatusText.textContent = text;
    el.serverStatus.classList.remove('is-hidden');

    // only the good news gets to go away on its own
    if (state === 'on') {
        hideStatusTimer = setTimeout(() => el.serverStatus.classList.add('is-hidden'), 2600);
    }

    /*
     * The board reads this to grey out the action bar. Sending a play into a
     * dead socket is not harmful — it queues — but a Play button that looks
     * exactly as it does when it works is the interface telling you something
     * it does not know.
     */
    document.body.dataset.link = socketUp ? link : 'offline';
}

function setLink(next) {
    if (link === next) return;
    link = next;
    paintStatus();
}

function setSocketUp(up) {
    if (socketUp === up) return;
    socketUp = up;
    paintStatus();
}

/** Back to the front door: no table, nothing to say about one. */
export function resetLink() {
    link = 'idle';
    paintStatus();
    el.serverStatus.classList.add('is-hidden');
}

/* ------------------------------------------------------------------ */
/* connection                                                          */
/* ------------------------------------------------------------------ */

export function connectServer() {
    const socket = window.io(SERVER_URL, SOCKET_OPTIONS);
    session.socket = socket;

    paintStatus();

    socket.on('connect', () => {
        session.socketId = socket.id;
        setSocketUp(true);
        onSocketUp();
    });

    socket.on('disconnect', (reason) => {
        session.socketId = null;
        setSocketUp(false);
        /*
         * 'io server disconnect' is the one reason socket.io will not retry on
         * its own. Everything else is already being retried for us.
         */
        if (reason === 'io server disconnect') socket.connect();
    });

    socket.on('connect_error', () => setSocketUp(false));

    /*
     * The relay announces a joiner to the host, but with only a socket id and a
     * name — nothing that says whether this is a new player or one coming back.
     * The handshake carries the key that does, so this is purely a safety net
     * for a HELLO that got lost on the way.
     *
     * Hence the wait. Every well-behaved client sends its HELLO in the same
     * breath as `join_room`, and nudging on arrival would fire before that
     * HELLO had landed, costing an extra round trip on every single join to
     * catch a case that has usually already resolved itself.
     */
    socket.on('player_joined', ({ id }) => {
        if (!localPlayer.isHost || !id) return;
        setTimeout(() => {
            if (!localPlayer.isHost || keyForSocket(id)) return;
            privateTo(id, 'REKNOCK', {});
        }, 1200);
    });

    socket.on('player_data', ({ id, data }) => hostReceive(data, id));
    socket.on('game_data', (data) => clientReceive(data));

    socket.on('error_msg', (message) => {
        /*
         * The only error the relay sends is "Room not found!", and it means the
         * code was wrong *or* the host was mid-reconnect when we knocked. Those
         * are indistinguishable from here, so a client that has been seated
         * before says nothing and lets the re-knock loop sort it out; only a
         * first attempt is worth reporting.
         */
        if (session.seated || localPlayer.isHost) return;
        el.clientStatus.textContent = String(message).replace(/!$/, '.');
        el.clientStatus.dataset.tone = 'bad';
    });

    startNetTick();
    return socket;
}

export const isConnected = () => !!session.socket?.connected;

/**
 * The socket is up. Whatever it was doing before it went down, it has to be
 * put back: the relay remembers rooms, but not who is in them.
 */
function onSocketUp() {
    if (!session.roomCode) {
        setLink('idle');
        return;
    }

    if (localPlayer.isHost) {
        /*
         * create_room on a code that already exists re-registers the caller as
         * its host, which is exactly the reclaim wanted here. Without it the
         * room goes on pointing at a socket that no longer exists, and every
         * client_send — every play, every call, every ping — is delivered to
         * nobody. The table looks fine from the host's side and is frozen from
         * everyone else's.
         */
        session.socket.emit('create_room', session.roomCode);
        setLink('live');
        flushOutbox();
        broadcastState();
        pulse();
    } else {
        session.seated = false;
        setLink('reseating');
        knock();
    }
}

/**
 * Called when the page comes back from being frozen or hidden. Timers do not
 * run in a backgrounded tab on a phone, so by the time we get here the
 * heartbeat has been stopped for however long the screen was off and both ends
 * have to be brought back into agreement at once rather than on the next beat.
 */
export function resumeNetwork() {
    // netTick() below applies the freeze credit before anything reads a clock
    if (!session.roomCode) {
        lastTickAt = Date.now();
        return;
    }

    const socket = session.socket;
    if (socket && !socket.connected) {
        // socket.io's own backoff may be mid-wait; ask for it now
        socket.connect();
    } else if (socket?.connected) {
        onSocketUp();
    }
    netTick();
}

/* ------------------------------------------------------------------ */
/* the handshake                                                       */
/* ------------------------------------------------------------------ */

/**
 * Ask to be seated. Sent on join, on every reconnect, and on a loop until the
 * host answers.
 *
 * Both halves matter and they do different jobs: `join_room` is what puts this
 * socket into the relay's room so broadcasts reach it, and HELLO is what tells
 * the host which player this socket belongs to. A socket that has done only the
 * first is a spectator; one that has done only the second is invisible.
 */
let lastKnockAt = 0;

function knock() {
    if (localPlayer.isHost || !session.roomCode || !isConnected()) return;
    lastKnockAt = Date.now();
    session.socket.emit('join_room', { roomCode: session.roomCode, name: localPlayer.name });
    sendMessage('HELLO', {
        key: MY_KEY,
        name: localPlayer.name,
        version: PROTOCOL_VERSION,
    });
}

/** Host: seat, or re-seat, whoever just introduced themselves. */
function onHello(socketId, payload) {
    if (!localPlayer.isHost || !socketId) return;

    const key = payload?.key;
    if (!key) return;

    if (payload.version !== PROTOCOL_VERSION) {
        privateTo(socketId, 'JOIN_REJECTED', {
            reason: 'version',
            message: 'That page is a different version of the game. Reload and try again.',
        });
        return;
    }

    const name = String(payload.name || '').trim().slice(0, NAME_MAX) || 'Player';
    const seated = gameState.players.find((p) => p.id === key);

    if (seated) {
        const conn = session.hostConnections[key];
        const wasAway = !conn || conn.away;

        // the address changes on every reconnect; the seat does not
        session.hostConnections[key] = { socketId, lastSeen: Date.now(), away: false };
        seated.name = name;

        welcome(key, socketId);
        if (wasAway) handlePlayerBack(key);
        else broadcastState();
        return;
    }

    if (gameState.gamePhase !== 'lobby') {
        privateTo(socketId, 'JOIN_REJECTED', {
            reason: 'in_progress',
            message: 'That game has already started.',
        });
        return;
    }

    if (gameState.players.length >= MAX_PLAYERS) {
        privateTo(socketId, 'JOIN_REJECTED', { reason: 'full', message: 'That table is full.' });
        return;
    }

    session.hostConnections[key] = { socketId, lastSeen: Date.now(), away: false };
    gameState.players.push({
        id: key,
        name,
        isHost: false,
        eliminated: false,
        away: false,
        hand: [],
        revolverDeck: [],
        revolverChambersLeft: REVOLVER_CHAMBERS,
        cardCount: 0,
    });

    sfx.join();
    toast(`${name} sat down.`, { type: 'success' });
    addLog(`${name} joined the table.`, 'system');
    welcome(key, socketId);
    updateLobbySeats();
    broadcastState();
}

/** Host: answer a handshake with everything needed to draw the table. */
function welcome(key, socketId) {
    privateTo(socketId, 'WELCOME', {
        yourId: key,
        hostName: localPlayer.name,
        version: PROTOCOL_VERSION,
        players: gameState.players.map((p) => ({
            id: p.id, name: p.name, isHost: p.isHost, cardCount: p.cardCount, away: !!p.away,
        })),
        config: gameState.config,
    });

    // ...and then the real thing, hand included, so a player who reconnects
    // mid-round lands back on the board holding the cards they left with
    const player = gameState.players.find((p) => p.id === key);
    if (player) privateTo(socketId, 'GAME_STATE_UPDATE', stateForClient(player));

    replayEnding(socketId);
}

/**
 * The result, for anyone who was not listening when it was announced.
 *
 * GAME_OVER is a single broadcast, and a single broadcast is exactly what a
 * phone misses. State alone is not enough to recover from: it carries the
 * phase but not the winner, the reason or the ledger, so a player who was
 * offline at the final shot would come back to a dead board with no result on
 * it and no rematch button — and the only way out of that is to leave the
 * table, which is how a lobby stops existing.
 */
function replayEnding(socketId) {
    if (gameState.gamePhase !== 'game_over') return;
    const ending = gameOverPayload();
    if (ending) privateTo(socketId, 'GAME_OVER', ending);
}

/** Client: the host has us. */
function onWelcome(payload) {
    /*
     * The join screen gives up after JOIN_TIMEOUT_MS and lets go of the room
     * code. A WELCOME that lands after that is answering a knock nobody is
     * waiting on any more, and seating on it would put the player at a table
     * this tab has already forgotten how to talk to.
     */
    if (!session.roomCode) return;

    const wasSeated = session.seated;
    session.seated = true;
    session.lastHostBeat = Date.now();
    setLink('live');

    gameState.players = payload.players ?? [];
    if (payload.config) Object.assign(gameState.config, payload.config);
    const me = gameState.players.find((p) => p.id === localPlayer.id);
    if (me) Object.assign(localPlayer, me);
    session.lastSeenState = JSON.parse(JSON.stringify(gameState));

    el.clientStatus.textContent = `Seated at ${payload.hostName}'s table.`;
    el.clientStatus.dataset.tone = 'ok';

    if (wasSeated) {
        addLog('Reconnected.', 'success');
    } else {
        sfx.join();
        addLog(`Joined ${payload.hostName}'s table.`, 'success');
        goToStep('table');
    }

    flushOutbox();
}

/* ------------------------------------------------------------------ */
/* the heartbeat                                                       */
/* ------------------------------------------------------------------ */

/*
 * One second, driving everything: the host's pulse, the client's ping, both
 * sides' timeouts and the re-knock loop. A single timer rather than four
 * because a phone that has been asleep resumes all of them in the same frame
 * anyway, and the order they run in should not be luck.
 */
const TICK_MS = 1000;

let tickTimer = null;
let lastPulseAt = 0;
let lastPingAt = 0;
let lastTickAt = 0;

function startNetTick() {
    clearInterval(tickTimer);
    lastTickAt = Date.now();
    tickTimer = setInterval(netTick, TICK_MS);
}

/**
 * Hand back the time this page spent frozen.
 *
 * Every timeout here is measured against the wall clock, which keeps running
 * while a backgrounded phone does not. So the first tick after a resume finds
 * all of them expired at once, and acts on all of them at once — which is
 * catastrophic in both directions. A client concludes the host has been silent
 * for the whole three minutes and quits to the lobby in the same frame the
 * screen lights up. A host concludes that every player at the table has been
 * silent for three minutes and eliminates all of them.
 *
 * Neither of those is true: nobody was silent, this page was deaf. So the
 * silence each of these clocks is measuring is pushed forward by the length of
 * the freeze, which leaves them holding exactly what they held going in, and
 * the timeouts start running again from the moment there was somebody here to
 * hear them.
 */
function creditFreeze(gap) {
    if (session.lastHostBeat) session.lastHostBeat += gap;
    Object.values(session.hostConnections).forEach((conn) => { conn.lastSeen += gap; });
}

/** Host: tell the room we're still here, and how current their copy should be. */
function pulse() {
    lastPulseAt = Date.now();
    sendMessage('PULSE', {
        v: gameState.stateVersion ?? 0,
        epoch: gameState.turnEpoch ?? 0,
        phase: gameState.gamePhase,
    });
}

function netTick() {
    const now = Date.now();
    const gap = lastTickAt ? now - lastTickAt : 0;
    lastTickAt = now;
    if (gap > FREEZE_GAP_MS) creditFreeze(gap);

    if (!session.roomCode) return;

    if (localPlayer.isHost) {
        if (isConnected() && now - lastPulseAt >= HEARTBEAT_MS) pulse();
        sweepConnections(now);
        return;
    }

    /* --- client --- */
    if (!isConnected()) return;

    if (!session.seated) {
        if (now - lastKnockAt >= REKNOCK_MS) knock();
        return;
    }

    if (now - lastPingAt >= HEARTBEAT_MS) {
        lastPingAt = now;
        sendMessage('PING', {});
    }

    const silent = now - (session.lastHostBeat || now);

    if (silent > HOST_LOST_MS) {
        toast('Lost the table. Back to the lobby.', { type: 'error' });
        addLog('The host never came back.', 'error');
        showLobby();
        return;
    }

    /*
     * Silence almost always means our own membership lapsed on a reconnect, not
     * that the host is gone: we can still send, we just stopped receiving. So
     * drop back to knocking rather than sitting quietly waiting for a broadcast
     * that is never going to be addressed to us.
     */
    if (silent > HOST_SILENT_MS) {
        session.seated = false;
        setLink('reseating');
        knock();
    }
}

/**
 * Host: mark the quiet away, and eventually let the long-gone go.
 *
 * Away is not elimination. A phone locks in a pocket for ninety seconds all the
 * time; the turn timer already keeps the game moving without them, and the seat
 * is worth more held than freed.
 */
function sweepConnections(now) {
    const dropAfter = gameState.gamePhase === 'lobby' ? DROP_AFTER_MS_LOBBY : DROP_AFTER_MS_GAME;
    let dirty = false;

    for (const player of [...gameState.players]) {
        /*
         * Eliminated players are skipped, and that is load-bearing rather than
         * an optimisation: letting somebody go deletes their connection record,
         * so without this the next sweep would find a player with no record,
         * drop them again, and broadcast a state update once a second for the
         * rest of the game.
         */
        if (player.id === localPlayer.id || player.eliminated) continue;

        const conn = session.hostConnections[player.id];
        if (!conn) continue;

        const since = now - conn.lastSeen;

        if (since > dropAfter) {
            handlePlayerGone(player.id, { reason: 'timeout' });
            continue;
        }

        const away = since > AWAY_AFTER_MS;
        if (away !== !!conn.away) {
            conn.away = away;
            player.away = away;
            addLog(
                away ? `${player.name} dropped out of contact.` : `${player.name} is back.`,
                away ? 'error' : 'success',
            );
            dirty = true;
        }
    }

    if (dirty) {
        updateLobbySeats();
        broadcastState();
    }

    // dealing a game drops anyone who was away, leaving their record behind
    pruneConnections();

    // with no turn timer running, somebody has to move a stalled game along
    sweepAwayTurn(now);
}

/** Host: when a player was last heard from, or 0. Used by the game rules. */
export function lastSeenOf(playerId) {
    if (playerId === localPlayer.id) return Date.now();
    return session.hostConnections[playerId]?.lastSeen ?? 0;
}

/* ------------------------------------------------------------------ */
/* sending                                                             */
/* ------------------------------------------------------------------ */

/**
 * Actions worth replaying if the socket was down when they were made.
 *
 * Deliberately short. A play or a call is a decision somebody made and should
 * survive a two-second blip; a heartbeat, a reaction or a state update is a
 * statement about *now* and is worthless late.
 */
const QUEUEABLE = new Set([
    'PLAYER_ACTION_PLAY_CARDS',
    'PLAYER_ACTION_CALL_LIAR',
    'PLAYER_TOGGLE_REMATCH_READY',
    'CLIENT_NAME_UPDATE',
]);

function privateTo(socketId, type, payload) {
    if (!socketId || !session.socket?.connected) return;
    session.socket.emit('host_private', {
        targetId: socketId,
        data: { type, payload, senderId: localPlayer.id },
    });
}

export function sendMessage(type, payload, targetPlayerId = null) {
    const socket = session.socket;
    if (!socket) return;

    const message = { type, payload, senderId: localPlayer.id };

    if (localPlayer.isHost) {
        if (targetPlayerId) {
            const socketId = session.hostConnections[targetPlayerId]?.socketId;
            if (socketId && socket.connected) {
                socket.emit('host_private', { targetId: socketId, data: message });
            }
            return;
        }
        if (socket.connected) socket.emit('host_broadcast', { roomCode: session.roomCode, data: message });
        return;
    }

    if (socket.connected) {
        socket.emit('client_send', { roomCode: session.roomCode, data: message });
        return;
    }

    if (QUEUEABLE.has(type)) {
        session.outbox.push({ message, at: Date.now() });
        if (session.outbox.length > OUTBOX_LIMIT) session.outbox.shift();
    }
}

function flushOutbox() {
    if (!session.outbox.length) return;
    const now = Date.now();
    const queued = session.outbox;
    session.outbox = [];

    queued
        .filter((entry) => now - entry.at <= OUTBOX_STALE_MS)
        .forEach((entry) => {
            if (localPlayer.isHost) return;
            session.socket.emit('client_send', { roomCode: session.roomCode, data: entry.message });
        });
}

/* ------------------------------------------------------------------ */
/* rooms                                                               */
/* ------------------------------------------------------------------ */

export function hostRoom(roomCode) {
    session.roomCode = roomCode;
    session.hostConnections = {};
    localPlayer.isHost = true;
    session.socket.emit('create_room', roomCode);
    setLink('live');

    gameState.players = [{
        id: localPlayer.id,
        name: localPlayer.name,
        isHost: true,
        eliminated: false,
        away: false,
        hand: [],
        revolverDeck: [],
        revolverChambersLeft: REVOLVER_CHAMBERS,
        cardCount: 0,
    }];

    addLog(`Table opened. Room code ${roomCode}.`, 'success');
    updateLobbySeats();
}

export function joinRoom(roomCode) {
    session.roomCode = roomCode;
    session.seated = false;
    session.lastHostBeat = Date.now();
    localPlayer.isHost = false;
    setLink('reseating');
    knock();
}

/** Tell the table we're going, for the cases where we actually know. */
export function announceDeparture() {
    if (localPlayer.isHost) {
        if (Object.keys(session.hostConnections).length) sendMessage('HOST_LEFT', {});
    } else if (session.roomCode) {
        sendMessage('CLIENT_LEFT', {});
    }
}

/* ------------------------------------------------------------------ */
/* receiving                                                           */
/* ------------------------------------------------------------------ */

/** Host: which player does this socket belong to? */
function keyForSocket(socketId) {
    for (const [key, conn] of Object.entries(session.hostConnections)) {
        if (conn.socketId === socketId) return key;
    }
    return null;
}

function hostReceive(msg, socketId) {
    if (!localPlayer.isHost || !msg?.type) return;

    if (msg.type === 'HELLO') {
        onHello(socketId, msg.payload);
        return;
    }

    /*
     * Identity comes from the socket binding the handshake set up, never from
     * the envelope: a message arriving on a socket the host does not recognise
     * is from somebody whose HELLO hasn't landed, and the fix is to ask them to
     * knock again rather than to take their word for who they are.
     */
    const senderId = keyForSocket(socketId);
    if (!senderId) {
        privateTo(socketId, 'REKNOCK', {});
        return;
    }

    const conn = session.hostConnections[senderId];
    conn.lastSeen = Date.now();

    switch (msg.type) {
        case 'PING':
            // presence is the whole message; the sweep does the rest
            break;
        case 'REQUEST_SYNC': {
            const player = gameState.players.find((p) => p.id === senderId);
            if (player) privateTo(socketId, 'GAME_STATE_UPDATE', stateForClient(player));
            replayEnding(socketId);
            break;
        }
        case 'PLAYER_ACTION_PLAY_CARDS':
            if (freshEnough(msg.payload)) handlePlayCards(senderId, msg.payload.cards);
            break;
        case 'PLAYER_ACTION_CALL_LIAR':
            if (freshEnough(msg.payload)) handleCallLiar(senderId);
            break;
        case 'PLAYER_TOGGLE_REMATCH_READY':
            handleRematchVote(senderId, msg.payload.isReady);
            break;
        case 'CLIENT_NAME_UPDATE':
            handleNameUpdate(senderId, msg.payload.name);
            break;
        case 'PLAYER_REACTION':
            handleReaction(senderId, msg.payload?.mark);
            break;
        case 'CLIENT_LEFT':
            handlePlayerGone(senderId, { reason: 'left' });
            break;
    }
}

/**
 * An action carries the turn it was decided on. Anything held in the outbox
 * through a reconnect can land a turn or two late, and a play meant for a hand
 * that has already been dealt away is not a move, it's a bug with a delay on
 * it. Actions from before the epoch existed are let through unchanged.
 */
function freshEnough(payload) {
    if (payload?.turnEpoch === undefined) return true;
    return payload.turnEpoch === (gameState.turnEpoch ?? 0);
}

function clientReceive(msg) {
    if (localPlayer.isHost || !msg?.type) return;

    // anything at all from the host counts as a sign of life
    session.lastHostBeat = Date.now();

    switch (msg.type) {
        case 'PULSE':
            if (!session.seated) {
                // we are being broadcast to, so the relay has us in the room;
                // the host just doesn't know which player we are yet
                knock();
                break;
            }
            setLink('live');
            /*
             * The version on the pulse is the self-healing part. A client that
             * quietly missed a broadcast — the common outcome of a reconnect —
             * finds out within one beat and asks for the state back, instead of
             * going on drawing a board that stopped being true several turns
             * ago.
             */
            if ((msg.payload?.v ?? 0) > (gameState.stateVersion ?? 0)) {
                sendMessage('REQUEST_SYNC', {});
            }
            break;

        case 'REKNOCK':
            session.seated = false;
            knock();
            break;

        case 'WELCOME':
            onWelcome(msg.payload);
            break;

        case 'JOIN_REJECTED':
            session.seated = false;
            session.roomCode = null;
            toast(msg.payload?.message ?? 'Could not join that table.', { type: 'error' });
            el.clientStatus.textContent = msg.payload?.message ?? 'Could not join.';
            el.clientStatus.dataset.tone = 'bad';
            el.connectBtn.disabled = false;
            showLobby();
            break;

        case 'GAME_STATE_UPDATE':
            session.seated = true;
            setLink('live');
            onClientStateUpdate(msg.payload);
            break;

        case 'CHALLENGE_ROULETTE_RESULTS':
            applyRouletteResults(msg.payload);
            break;

        case 'GAME_OVER':
            showGameOver(msg.payload);
            break;

        // the sender's own mark is dropped inside showReaction: it was already
        // drawn locally on the way out, and this is the relay echoing it back
        case 'REACTION':
            showReaction(msg.payload?.playerId, msg.payload?.mark);
            break;

        case 'HOST_LEFT':
            toast('The host left. Back to the lobby.', { type: 'error' });
            addLog('Host disconnected.', 'error');
            showLobby();
            break;
    }
}

/* ------------------------------------------------------------------ */
/* helpers used by game logic                                          */
/* ------------------------------------------------------------------ */

/**
 * Everyone who is in the game *and* currently in contact.
 *
 * Away players are deliberately not in here: this is what decides who a rematch
 * waits on and who gets dealt in, and a table should never be held up by a
 * phone that is face down on the bar.
 */
export function activeConnectedIds() {
    if (!localPlayer.isHost) return gameState.players.filter((p) => !p.away).map((p) => p.id);

    return gameState.players
        .filter((p) => {
            if (p.id === localPlayer.id) return true;
            const conn = session.hostConnections[p.id];
            return !!conn && !conn.away;
        })
        .map((p) => p.id);
}

export function suitSymbol(suit) {
    return SUIT_SYMBOLS[suit] ?? suit;
}
