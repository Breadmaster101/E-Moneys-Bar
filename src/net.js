/**
 * net.js: the Socket.IO relay layer.
 *
 * The server is a dumb pipe: one player is the host and owns the truth, every
 * other player mirrors whatever the host broadcasts.
 */

import { SERVER_URL, MAX_PLAYERS, REVOLVER_CHAMBERS, SUIT_SYMBOLS } from './constants.js';
import { el } from './dom.js';
import { gameState, localPlayer, session } from './state.js';
import { toast } from './toast.js';
import { addLog } from './log.js';
import { sfx } from './audio.js';
import {
    handlePlayCards,
    handleCallLiar,
    handleClientDisconnect,
    handleRematchVote,
    handleNameUpdate,
} from './game.js';
import {
    showLobby,
    showGameBoard,
    applyRouletteResults,
    showGameOver,
    updateRematchStatus,
    onClientStateUpdate,
    updateLobbySeats,
} from './ui.js';
import { goToStep } from './lobby.js';

/* ------------------------------------------------------------------ */
/* connection                                                          */
/* ------------------------------------------------------------------ */

function setServerStatus(state, text) {
    el.serverStatus.dataset.state = state;
    el.serverStatusText.textContent = text;
    el.serverStatus.classList.remove('is-hidden');
    if (state === 'on') {
        setTimeout(() => el.serverStatus.classList.add('is-hidden'), 2600);
    }
}

export function connectServer() {
    const socket = window.io(SERVER_URL);
    session.socket = socket;

    setServerStatus('connecting', 'Waking the server… this can take a minute.');

    socket.on('connect', () => {
        localPlayer.id = socket.id;
        setServerStatus('on', 'Connected');
    });

    socket.on('disconnect', () => {
        setServerStatus('off', 'Disconnected, reconnecting…');
    });

    socket.on('connect_error', () => {
        setServerStatus('off', 'Can’t reach the server. Retrying…');
    });

    // --- host inbox ---
    socket.on('player_joined', ({ id, name }) => onPlayerJoined(id, name));

    socket.on('player_data', ({ id, data }) => {
        if (data?.type === 'CLIENT_DISCONNECTED') handleClientDisconnect(id);
        else routeMessage(data);
    });

    // --- client inbox ---
    socket.on('game_data', (data) => {
        if (data?.type === 'ROOM_FULL_REJECT') {
            toast('That table is full.', { type: 'error' });
            showLobby();
            return;
        }
        routeMessage(data);
    });

    socket.on('error_msg', (message) => {
        toast(String(message), { type: 'error' });
        showLobby();
    });

    return socket;
}

export const isConnected = () => !!session.socket?.connected;

/* ------------------------------------------------------------------ */
/* sending                                                             */
/* ------------------------------------------------------------------ */

export function sendMessage(type, payload, targetClientId = null) {
    const socket = session.socket;
    if (!socket) return;

    const message = { type, payload, senderId: localPlayer.id };

    if (localPlayer.isHost) {
        if (targetClientId) {
            if (session.hostConnections[targetClientId]) {
                socket.emit('host_private', { targetId: targetClientId, data: message });
            }
        } else {
            socket.emit('host_broadcast', { roomCode: session.roomCode, data: message });
        }
    } else if (socket.connected) {
        socket.emit('client_send', { roomCode: session.roomCode, data: message });
    }
}

/* ------------------------------------------------------------------ */
/* rooms                                                               */
/* ------------------------------------------------------------------ */

export function hostRoom(roomCode) {
    session.roomCode = roomCode;
    localPlayer.id = session.socket.id;
    localPlayer.isHost = true;
    session.socket.emit('create_room', roomCode);

    gameState.players = [{
        id: localPlayer.id,
        name: localPlayer.name,
        isHost: true,
        eliminated: false,
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
    localPlayer.id = session.socket.id;
    localPlayer.isHost = false;
    session.socket.emit('join_room', { roomCode, name: localPlayer.name });
}

function onPlayerJoined(id, name) {
    if (!localPlayer.isHost) return;

    if (Object.keys(session.hostConnections).length >= MAX_PLAYERS - 1) {
        session.socket.emit('host_private', { targetId: id, data: { type: 'ROOM_FULL_REJECT' } });
        return;
    }

    session.hostConnections[id] = true;

    const player = {
        id,
        name: name || `Player ${Object.keys(session.hostConnections).length + 1}`,
        isHost: false,
        eliminated: false,
        hand: [],
        revolverDeck: [],
        revolverChambersLeft: REVOLVER_CHAMBERS,
        cardCount: 0,
    };
    gameState.players.push(player);

    sfx.join();
    toast(`${player.name} sat down.`, { type: 'success' });
    addLog(`${player.name} joined the table.`, 'system');
    updateLobbySeats();

    sendMessage('PLAYER_JOINED_ACK', {
        yourId: id,
        hostName: localPlayer.name,
        players: gameState.players.map((p) => ({
            id: p.id, name: p.name, isHost: p.isHost, cardCount: p.cardCount,
        })),
        config: gameState.config,
    }, id);
}

/* ------------------------------------------------------------------ */
/* receiving                                                           */
/* ------------------------------------------------------------------ */

function routeMessage(message) {
    if (!message?.type) return;
    if (localPlayer.isHost) hostReceive(message);
    else clientReceive(message);
}

function hostReceive(msg) {
    switch (msg.type) {
        case 'PLAYER_ACTION_PLAY_CARDS':
            handlePlayCards(msg.senderId, msg.payload.cards);
            break;
        case 'PLAYER_ACTION_CALL_LIAR':
            handleCallLiar(msg.senderId);
            break;
        case 'PLAYER_TOGGLE_REMATCH_READY':
            handleRematchVote(msg.senderId, msg.payload.isReady);
            break;
        case 'CLIENT_NAME_UPDATE':
            handleNameUpdate(msg.senderId, msg.payload.name);
            break;
        case 'CLIENT_DISCONNECTED':
            handleClientDisconnect(msg.senderId);
            break;
    }
}

function clientReceive(msg) {
    switch (msg.type) {
        case 'GAME_STATE_UPDATE':
            onClientStateUpdate(msg.payload);
            break;

        case 'CHALLENGE_ROULETTE_RESULTS':
            applyRouletteResults(msg.payload);
            break;

        case 'GAME_OVER':
            showGameOver(msg.payload);
            break;

        case 'PLAYER_JOINED_ACK': {
            gameState.players = msg.payload.players;
            if (msg.payload.config) Object.assign(gameState.config, msg.payload.config);
            const me = gameState.players.find((p) => p.id === localPlayer.id);
            if (me) Object.assign(localPlayer, me);
            session.lastSeenState = JSON.parse(JSON.stringify(gameState));

            el.clientStatus.textContent = `Seated at ${msg.payload.hostName}'s table.`;
            el.clientStatus.dataset.tone = 'ok';
            sfx.join();
            addLog(`Joined ${msg.payload.hostName}'s table.`, 'success');
            goToStep('table');
            break;
        }

        case 'HOST_DISCONNECTED':
            toast('The host left. Back to the lobby.', { type: 'error' });
            addLog('Host disconnected.', 'error');
            showLobby();
            break;
    }
}

/* ------------------------------------------------------------------ */
/* helpers used by game logic                                          */
/* ------------------------------------------------------------------ */

/** Every player who is both in the game and still connected. */
export function activeConnectedIds() {
    const ids = localPlayer.isHost
        ? [localPlayer.id, ...Object.keys(session.hostConnections).filter((id) => session.hostConnections[id])]
        : gameState.players.map((p) => p.id);
    return ids.filter((id) => gameState.players.some((p) => p.id === id));
}

export function suitSymbol(suit) {
    return SUIT_SYMBOLS[suit] ?? suit;
}
