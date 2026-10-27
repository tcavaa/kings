'use strict';

// ─── tournament ─────────────────────────────────────────────────────────────
// A tournament is a lobby that fills to exactly 6 or 9, splits at random into
// 3-player King tables, and feeds three finalists into one last table.
// Everyone entered also sits in a socket room named after the tournament id
// so roster and bracket updates reach them wherever they are.

const { ownsSeat } = require('../game/GameManager');
const { playersView, identify } = require('./shared');
const { emitGameStart } = require('./gameFlow');
const { LOBBY } = require('./lobby');

/** A tournament's roster changed: its entrants hear it, and the lobby's list follows. */
function tournamentSync(ctx, t) {
  if (!t) return;
  ctx.io.to(t.id).emit('tournament-state', ctx.tournamentManager.lobbyView(t));
  ctx.lobby.tournaments();
}

/**
 * The emitting half of the tournament manager.
 *
 * Starting a bracket table has to look exactly like a normal game start to the
 * client, so it reuses the same `room-joined` → `game-started` → `hand-dealt`
 * sequence the start-game handler emits. `reconnected: true` is what moves the
 * client straight onto the table instead of parking it in a waiting room —
 * the players never chose this room, so there is no lobby step for them.
 */
function createBroadcaster(ctx) {
  const { io, tournamentManager } = ctx;
  const overviewOf = (t) => tournamentManager.overview(t);

  return {
    startTable(t, roomCode, group, stage, index, gameState) {
      const room = ctx.gameManager.getRoom(roomCode);
      if (!room || !gameState) return;

      // Seating moved every player's socket off its previous room (see the
      // 'socket-detached' handler), so a finalist no longer hears its
      // semifinal. Offline entrants have no socket to tell.
      for (const p of room.players) {
        if (!p.id || !p.connected) continue;
        // Join by socket id: every socket is implicitly in a room named after
        // itself, so this works without holding socket objects.
        io.in(p.id).socketsJoin(roomCode);
        io.to(p.id).emit('room-joined', {
          roomCode,
          seat: p.seat,
          reconnected: true,
          status: 'playing',
          mode: 'championship',
          startedAt: room.startedAt || null,
          tournament: { id: t.id, code: t.code, stage, table: index },
        });
      }

      emitGameStart(ctx, room, gameState);
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },

    overviewChanged(t) {
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },

    /** An entrant left a lobby, or was dropped for staying away. */
    lobbyChanged({ tournament }) {
      if (tournament) tournamentSync(ctx, tournament);
      else ctx.lobby.tournaments();
    },

    finalStarted(t, roomCode, finalists) {
      tournamentSync(ctx, t);
      io.to(t.id).emit('tournament-final', {
        roomCode,
        finalists: finalists.map((f) => ({
          name: f.name, avatar: f.avatar || null,
          score: f.score, wildcard: !f.isWinner,
        })),
        standings: t.standings,
      });
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },

    tournamentComplete(t) {
      tournamentSync(ctx, t);
      io.to(t.id).emit('tournament-complete', {
        code: t.code,
        winners: t.winners,
        standings: t.standings,
      });
      io.to(t.id).emit('tournament-overview', overviewOf(t));
      // It's over: its channel has nothing more to say.
      io.in(t.id).socketsLeave(t.id);
    },
  };
}

function register(io, socket, ctx, conn) {
  const { gameManager, tournamentManager, lobby } = ctx;
  const { socketId, allow, emitError, fail } = conn;
  const sync = (t) => tournamentSync(ctx, t);

  socket.on('tournament-create', async (payload = {}) => {
    try {
      if (!tournamentManager) return emitError('Tournaments are unavailable.');
      if (!allow('tournament')) return;
      const me = await identify(socket, payload);
      conn.assertNoTable();
      const t = tournamentManager.create(socketId, me, payload.size);
      socket.join(t.id);
      socket.emit('tournament-joined', tournamentManager.lobbyView(t));
      sync(t);
    } catch (err) { fail(err); }
  });

  // Entering a lobby, or coming back to an entry after a refresh or a socket
  // blip — in which case a player whose bracket is already running is seated
  // back at their live table.
  socket.on('tournament-join', async (payload = {}) => {
    try {
      if (!tournamentManager) return emitError('Tournaments are unavailable.');
      if (!allow('tournament')) return;
      const me = await identify(socket, payload);
      conn.assertNoTable(tournamentManager.findByCode(payload.code)?.id);
      const { tournament: t, rejoined } = tournamentManager.join(payload.code, socketId, me);
      socket.join(t.id);
      socket.emit('tournament-joined', tournamentManager.lobbyView(t));
      if (rejoined && t.status !== 'lobby') {
        // Its tables may have left memory while nobody was there (after a
        // restart, say) — they come back from the database.
        await tournamentManager.loadRooms(t);
        socket.emit('tournament-overview', tournamentManager.overview(t));
        const rc = tournamentManager.liveRoomOf(t, me);
        if (rc && gameManager.getMappingBySocketId(socketId)?.roomCode !== rc) {
          const { seat } = gameManager.joinRoom(rc, socketId, me);
          socket.join(rc);
          conn.emitReconnected(rc, seat, me);
        }
        sync(t);
        return;
      }
      sync(t);
      // The draw happens the moment the last seat is taken.
      if (tournamentManager.isFull(t)) {
        tournamentManager.startSemifinal(t);
        sync(t);
        io.to(t.id).emit('tournament-overview', tournamentManager.overview(t));
      }
    } catch (err) { fail(err); }
  });

  socket.on('tournament-leave', () => {
    try {
      if (!tournamentManager) return;
      const res = tournamentManager.leave(socketId);
      if (!res) return;
      socket.leave(res.id);
      socket.emit('tournament-left');
      if (res.tournament) sync(res.tournament);
      else lobby.tournaments();
    } catch (err) { /* no-op */ }
  });

  socket.on('tournament-list', () => {
    try {
      if (!tournamentManager) return;
      lobby.enter(socket, 'tournaments');
    } catch (err) { /* no-op */ }
  });

  // Live cross-table view — which round every table is on and the scores.
  // Open to anyone: a `code` names the tournament (the homepage list), and
  // without one it is the socket's own — the one it is entered in, seated at,
  // or watching a table of.
  socket.on('tournament-overview', (payload = {}) => {
    try {
      if (!tournamentManager) return;
      const at = gameManager.getMappingBySocketId(socketId)?.roomCode
        || gameManager.getSpectator(socketId)?.roomCode;
      const t = (payload?.code && tournamentManager.findByCode(payload.code))
        || tournamentManager.findBySocket(socketId)
        || (at ? tournamentManager.findByRoom(at) : null);
      if (!t) return;
      socket.emit('tournament-overview', tournamentManager.overview(t));
    } catch (err) { /* no-op */ }
  });

  // Watch another table. Safe by construction: every hand-bearing emit is
  // addressed to a specific player socket (`io.to(player.id)`), never to the
  // room, so joining the room channel exposes only the shared action — cards
  // played, tricks, scores. The one thing a watcher would otherwise miss is
  // the current state, and that goes through the masked
  // `getStateForSpectator()`.
  socket.on('tournament-spectate', async (payload = {}) => {
    try {
      if (!tournamentManager) return;
      if (!allow('watch')) return;
      const rc = String(payload.roomCode || '').toUpperCase();
      const me = await identify(socket, payload);
      const room = gameManager.getRoom(rc);
      if (!room) return emitError('That table is no longer available.');

      const t = tournamentManager.findByRoom(rc);
      if (!t) return emitError('That table is not part of a tournament.');
      // Only people in this tournament may watch its tables.
      const entrant = t.players.find((p) => p.id === socketId || ownsSeat(p, me));
      if (!entrant) return emitError('Only players in this tournament can watch.');

      // Watching is for players whose own table is done. Two reasons to be
      // strict here: a masked state would overwrite the real one and hide
      // your own hand, and every play/quit event still resolves through
      // socketRoomMap — so a watcher with a live seat would be acting on one
      // table while looking at another.
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (mapping) {
        if (mapping.roomCode === rc) {
          return emitError('You are playing at that table.');
        }
        const own = gameManager.getRoom(mapping.roomCode);
        if (own && own.status !== 'finished') {
          return emitError('Finish your own game before watching another table.');
        }
      }

      const previous = gameManager.removeSpectator(socketId);
      if (previous && previous.roomCode !== rc) socket.leave(previous.roomCode);

      gameManager.addSpectator(socketId, rc, {
        tournamentId: t.id,
        name: entrant.name,
        avatar: entrant.avatar || null,
      });
      socket.join(rc);
      socket.leave(LOBBY);

      socket.emit('spectate-started', {
        roomCode: rc,
        tournamentId: t.id,
        tournamentCode: t.code,
        startedAt: room.startedAt || null,
        players: playersView(room.players),
        stage: room.tournamentStage || null,
        table: room.tournamentTable ?? null,
      });
      if (room.gameState) {
        socket.emit('game-state', {
          ...room.gameState.getStateForSpectator(),
          players: playersView(room.players),
        });
      }
      lobby.refresh();
    } catch (err) { fail(err); }
  });
}

module.exports = { register, createBroadcaster, tournamentSync };
