'use strict';

// One socket's helpers, shared by its handler modules: its rate limits, error
// replies, which table or tournament it is in, and the reconnect and
// quick-match start sequences.

const { ownsSeat } = require('../game/GameManager');
const {
  playersView, championshipBlocked, CHAMPIONSHIP_LIMIT_MESSAGE, rateLimiter,
} = require('./shared');
const { emitGameStart } = require('./gameFlow');
const { LOBBY } = require('./lobby');

function createConnection(io, socket, ctx) {
  const { gameManager, tournamentManager, lobby } = ctx;
  const socketId = socket.id;

  function emitError(message, code) { socket.emit('error', { message, code }); }

  const conn = {
    socketId,
    allow: rateLimiter(),
    emitError,
    fail: (err) => emitError(err.message, err.code),
    championshipBlocked: (name) => championshipBlocked(gameManager, name),
    emitChampionshipLimit: () => emitError(CHAMPIONSHIP_LIMIT_MESSAGE, 'CHAMPIONSHIP_LIMIT'),
  };

  // One table at a time per socket: a homepage seat and a tournament entry
  // would both point this socket's room mapping at different games, and one
  // of the two tables would stall.

  /** The waiting or running room this socket sits at, if any. */
  conn.tableOf = () => {
    const mapping = gameManager.getMappingBySocketId(socketId);
    const room = mapping && gameManager.getRoom(mapping.roomCode);
    return room && (room.status === 'waiting' || room.status === 'playing') ? room : null;
  };

  /**
   * The tournament that may still seat this socket: any stage up to the end
   * of the semifinals (finalists are only known then), and the final for
   * the finalists.
   */
  conn.tournamentOf = () => {
    const t = tournamentManager?.findBySocket(socketId);
    if (!t || t.status !== 'final') return t || null;
    const entry = t.players.find((p) => p.id === socketId);
    const final = gameManager.getRoom(t.finalRoomCode);
    return final && final.status === 'playing' && final.players.some((p) => ownsSeat(p, entry)) ? t : null;
  };

  /** Refuse a new table while the socket is in a tournament (its own tables excepted). */
  conn.assertNoTournament = (roomCode) => {
    const t = conn.tournamentOf();
    if (t && !(roomCode && gameManager.getRoom(roomCode)?.tournamentId === t.id)) {
      throw new Error('You are in a tournament — leave it first.');
    }
  };

  /** Refuse a tournament while the socket sits at another table. */
  conn.assertNoTable = (tournamentId) => {
    const room = conn.tableOf();
    if (room && !(tournamentId && room.tournamentId === tournamentId)) {
      throw new Error('You are at a table — leave it first.');
    }
  };

  /**
   * The seat this socket plays, for the game actions. Reports the error and
   * returns null when there's none (or, with needGame, no game yet).
   */
  conn.seatOf = ({ needGame = true } = {}) => {
    const mapping = gameManager.getMappingBySocketId(socketId);
    if (!mapping) { emitError('You are not in a room.'); return null; }
    const room = gameManager.getRoom(mapping.roomCode);
    if (!room) { emitError('Room not found.'); return null; }
    if (needGame && !room.gameState) { emitError('Game not found.'); return null; }
    return { roomCode: mapping.roomCode, seat: mapping.seat, room, gs: room.gameState };
  };

  /** A socket handler that runs `fn(seat, payload)` for a seated player. */
  conn.withSeat = (fn, options) => (payload = {}) => {
    try {
      const at = conn.seatOf(options);
      if (at) fn(at, payload || {});
    } catch (err) {
      conn.fail(err);
    }
  };

  /**
   * Back in an existing seat (a reconnect). `room-joined` tells the client
   * which screen to land on; at a bracket table the tournament entry follows
   * the new socket too, or the final would be seated on the dead one.
   */
  conn.emitReconnected = (rc, seat, me) => {
    const room = gameManager.getRoom(rc);
    if (!room) return;
    let tournamentTag = null;
    if (room.tournamentId && tournamentManager) {
      const t = tournamentManager.rebind(socketId, me);
      if (t) {
        socket.join(t.id);
        tournamentTag = { id: t.id, code: t.code, stage: room.tournamentStage, table: room.tournamentTable };
        socket.emit('tournament-state', tournamentManager.lobbyView(t));
        socket.emit('tournament-overview', tournamentManager.overview(t));
      }
    }
    if (room.status === 'playing') socket.leave(LOBBY);
    socket.emit('room-joined', {
      roomCode: rc, seat, reconnected: true, status: room.status, mode: room.mode || 'public',
      startedAt: room.startedAt || null, tournament: tournamentTag,
    });
    const state = gameManager.getStateForPlayer(rc, seat);
    if (state) socket.emit('game-state', { ...state, players: playersView(room.players) });
    io.to(rc).emit('player-reconnected', { roomCode: rc, playerName: me.name, players: playersView(room.players) });
    if (room.isPublic && room.status === 'waiting') lobby.publicRoom();
    lobby.refresh();
  };

  /** A room just got its third player: homepage tables start on their own. */
  conn.maybeAutoStart = (room) => {
    if (!room || !room.isPublic || room.status !== 'waiting' || room.players.length !== 3) return;
    const gameState = gameManager.startGame(room.code);
    emitGameStart(ctx, room, gameState);
    // Free the homepage seats for the next trio. The trio has just left the
    // lobby channel, so they get the cleared view directly.
    gameManager.clearPublicRoom(room.code);
    io.to(room.code).emit('public-room', gameManager.publicRoomView());
    lobby.publicRoom();
  };

  return conn;
}

module.exports = { createConnection };
