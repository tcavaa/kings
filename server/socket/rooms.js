'use strict';

// Taking and leaving seats: private rooms, the homepage quick-match tables,
// starting a game, Play Again, leaving, and what a dropped socket leaves
// behind.

const { normalizeMode } = require('../lib/util');
const { playersView, identify, sanitizeEmoji } = require('./shared');
const { emitGameStart } = require('./gameFlow');

// How long a disconnected player keeps their public-table seat before it's
// swept and offered to the next sitter (long enough to survive a refresh).
const PUBLIC_SEAT_GRACE_MS = 30 * 1000;

function register(io, socket, ctx, conn) {
  const { gameManager, tournamentManager, lobby } = ctx;
  const { socketId, allow, emitError, fail, championshipBlocked, emitChampionshipLimit } = conn;

  // ─── create-room ─────────────────────────────────────────────────────────
  socket.on('create-room', async (payload = {}) => {
    try {
      if (!allow('join')) return;
      const me = await identify(socket, payload);
      conn.assertNoTournament();
      const roomMode = normalizeMode(payload.mode);
      if (roomMode === 'championship' && await championshipBlocked(me.name)) {
        return emitChampionshipLimit();
      }
      const { roomCode, seat } = gameManager.createRoom(socketId, me, roomMode);
      socket.join(roomCode);
      const room = gameManager.getRoom(roomCode);
      socket.emit('room-created', { roomCode, seat, mode: roomMode });
      io.to(roomCode).emit('player-joined', {
        players: playersView(room.players),
        roomCode,
        mode: room.mode,
      });
    } catch (err) {
      fail(err);
    }
  });

  // ─── join-room ────────────────────────────────────────────────────────────
  socket.on('join-room', async (payload = {}) => {
    try {
      const { roomCode } = payload;
      if (!roomCode || typeof roomCode !== 'string') return emitError('roomCode is required.');
      if (!allow('join')) return;
      const me = await identify(socket, payload);

      const rc = roomCode.toUpperCase().slice(0, 16);
      // If the room isn't currently in memory (e.g. server restarted while the
      // game was live), look it up in the database and rehydrate before joining.
      // This is the rejoin recovery path.
      if (!gameManager.getRoom(rc)) {
        await gameManager.tryLoadFromDB(rc);
      }
      conn.assertNoTournament(rc);

      // Championship rooms enforce the daily quota on genuinely NEW sit-downs
      // only — a reconnect (same name already seated) must never be blocked,
      // or a mid-game wifi blip would lock a player out of their own table.
      const targetRoom = gameManager.getRoom(rc);
      // Tournament tables are championship-grade for the leaderboard but are
      // explicitly exempt from the daily allowance — entering a bracket must
      // never be refused because of, or count against, the 8-a-day cap.
      if (targetRoom && targetRoom.mode === 'championship' && !targetRoom.tournamentId) {
        if (!gameManager.isSeated(targetRoom, me) && await championshipBlocked(me.name)) {
          return emitChampionshipLimit();
        }
      }

      const { seat, reconnected, status } = gameManager.joinRoom(rc, socketId, me);
      socket.join(rc);
      const room = gameManager.getRoom(rc);
      const roomMode = room?.mode || 'public';

      if (reconnected) {
        conn.emitReconnected(rc, seat, me);
        return;
      }

      socket.emit('room-joined', {
        roomCode: rc, seat, status, mode: roomMode,
      });
      io.to(rc).emit('player-joined', {
        players: playersView(room.players),
        roomCode: rc,
        mode: roomMode,
      });
      // A homepage table joined by its code fills up like one sat at.
      if (room.isPublic) {
        lobby.publicRoom();
        conn.maybeAutoStart(room);
      }
    } catch (err) {
      fail(err);
    }
  });

  // ─── public quick-match room ──────────────────────────────────────────────

  // Sit at one of the homepage quick-match tables ('public' by default,
  // 'championship' when requested). The sitter stays on the homepage — no
  // waiting-room redirect — until the 3rd seat fills, at which point the
  // game starts automatically for all three and the table's slot resets.
  socket.on('sit-public', async (payload = {}) => {
    try {
      if (!allow('join')) return;
      const me = await identify(socket, payload);
      conn.assertNoTournament();
      const tableMode = normalizeMode(payload.mode);
      // Quota applies to fresh sit-downs only; re-taking your own seat after
      // a refresh must always work.
      if (tableMode === 'championship') {
        const waitingRoom = gameManager.quickMatchRoom(tableMode);
        if (!gameManager.isSeated(waitingRoom, me) && await championshipBlocked(me.name)) {
          return emitChampionshipLimit();
        }
      }
      const { roomCode, seat } = gameManager.sitPublic(
        socketId, me, sanitizeEmoji(payload.emoji), tableMode
      );
      socket.join(roomCode);
      socket.emit('public-seated', { roomCode, seat, mode: tableMode });
      lobby.publicRoom();
      conn.maybeAutoStart(gameManager.getRoom(roomCode));
    } catch (err) {
      fail(err);
    }
  });

  // Stand up from the public table (only valid while it's still waiting).
  socket.on('stand-public', () => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return;
      const { roomCode } = mapping;
      const room = gameManager.getRoom(roomCode);
      if (!room || !room.isPublic || room.status !== 'waiting') return;
      gameManager.leaveRoom(socketId);
      socket.leave(roomCode);
      socket.emit('public-unseated');
      lobby.publicRoom();
    } catch (err) { /* no-op */ }
  });

  // Pick/clear the reaction emoji shown above the seated profile.
  socket.on('set-public-emoji', ({ emoji } = {}) => {
    try {
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (!mapping) return;
      const room = gameManager.getRoom(mapping.roomCode);
      if (!room || !room.isPublic || room.status !== 'waiting') return;
      const player = room.players.find((p) => p.seat === mapping.seat);
      if (!player) return;
      const next = sanitizeEmoji(emoji);
      if (next === (player.emoji || null) || !allow('emoji')) return;
      player.emoji = next;
      lobby.publicRoom();
    } catch (err) { /* no-op */ }
  });

  // Refresh recovery: re-attach ONLY (never fresh-sit) to the seat the
  // client stashed when it sat down. If the game has started in the meantime
  // this falls through to the standard in-game reconnect flow.
  socket.on('rejoin-public', async (payload = {}) => {
    try {
      if (!allow('join')) return socket.emit('public-rejoin-failed');
      const rc = String(payload.roomCode || '').toUpperCase();
      const room = gameManager.getRoom(rc);
      const me = await identify(socket, payload);
      if (!room || !gameManager.isSeated(room, me)) return socket.emit('public-rejoin-failed');
      const { seat, status } = gameManager.joinRoom(rc, socketId, me);
      socket.join(rc);
      if (status === 'waiting') {
        socket.emit('public-seated', { roomCode: rc, seat, mode: room.mode || 'public' });
        lobby.publicRoom();
      } else {
        conn.emitReconnected(rc, seat, me);
      }
    } catch (err) {
      socket.emit('public-rejoin-failed');
    }
  });

  // ─── start-game ──────────────────────────────────────────────────────────
  socket.on('start-game', conn.withSeat(({ roomCode, seat, room }) => {
    // A second tap after the game started has nothing left to do.
    if (room.status !== 'waiting') return;
    if (seat !== 0) return emitError('Only the room creator can start the game.');
    const gameState = gameManager.startGame(roomCode);
    emitGameStart(ctx, room, gameState);
  }, { needGame: false }));

  // ─── rematch ──────────────────────────────────────────────────────────────
  //
  // Triggered by the "Play Again" button on the game-over screen. The first
  // click creates a fresh room with the clicker as seat 0; every subsequent
  // click from the same finished room is forwarded into that same new room
  // via joinRoom(). All sockets still in the OLD room get a `rematch-status`
  // broadcast so non-joiners can render a "wants to play again" badge above
  // each joined seat's avatar — and so non-clickers see the new room code
  // and can hit Play Again themselves.
  socket.on('request-rematch', async () => {
    try {
      const oldMapping = gameManager.getMappingBySocketId(socketId);
      if (!oldMapping) return emitError('You are not in a room.');
      const oldRoom = gameManager.getRoom(oldMapping.roomCode);
      if (!oldRoom) return emitError('Room not found.');
      // The new room keeps the identity of the seat this socket holds.
      const seatRow = oldRoom.players.find((p) => p.seat === oldMapping.seat);
      if (!seatRow) return emitError('Player name unavailable.');
      const me = {
        name: seatRow.name, avatar: seatRow.avatar || null,
        profileId: seatRow.profileId || null, ownerKey: seatRow.ownerKey || socket.data.ownerKey || null,
      };

      // A repeated tap lands in the rematch room it already created or
      // joined: answer it again, without a second quota check.
      const repeat = oldRoom.status === 'waiting' && oldRoom.rematchOf;
      if (!repeat) {
        // A tournament seat is not rematchable — the bracket decides what
        // comes next, and spawning a stray room here would strand the player
        // outside it while their real table waits.
        if (oldRoom.tournamentId) {
          return emitError('Tournament games cannot be replayed.');
        }
        // A championship rematch is a brand-new championship game — the one
        // that just finished already counts (saved or not), so after a
        // player's last game of the day this correctly refuses (they can
        // still rematch publicly by creating a room from the lobby).
        if (oldRoom.mode === 'championship' && oldRoom.status === 'finished'
            && await championshipBlocked(me.name)) {
          return emitChampionshipLimit();
        }
      }

      const result = gameManager.requestRematch(socketId, me);
      if (result.error) return emitError(result.error);

      const { newRoomCode, seat, joinedOldSeats, oldRoomCode } = result;
      // Pull the requester out of the old socket.io room so they don't
      // keep receiving its broadcasts while sitting in the new lobby.
      socket.leave(oldRoomCode);
      socket.join(newRoomCode);

      // Tell the requester their new seat — same shape as `room-joined`
      // so the client uses the existing handler to transition into the
      // waiting room UI without a new code path.
      socket.emit('room-joined', {
        roomCode: newRoomCode, seat, status: 'waiting',
      });

      // Send the new lobby's player list to the requester so the waiting
      // room is populated immediately (otherwise the first joiner sits
      // there alone with no UI cue until the next player joins).
      const newRoom = gameManager.getRoom(newRoomCode);
      if (newRoom) {
        io.to(newRoomCode).emit('player-joined', {
          players: playersView(newRoom.players),
          roomCode: newRoomCode,
        });
      }

      // Fan-out to every socket still in the old (finished) room so
      // their game-over UI can render the "wants to play again" badges
      // and surface the rematch room code.
      io.to(oldRoomCode).emit('rematch-status', {
        newRoomCode,
        joinedOldSeats,
      });
    } catch (err) {
      fail(err);
    }
  });

  // ─── leave-room ───────────────────────────────────────────────────────────
  socket.on('leave-room', () => {
    try {
      const result = gameManager.leaveRoom(socketId);
      lobby.enter(socket);
      if (!result) return;
      const { roomCode, playerName, room } = result;
      socket.leave(roomCode);
      lobby.refresh();
      if (result.stayed) {
        // Left a running game: the seat stays for its owner (see leaveRoom).
        if (room.players.every((p) => !p.connected)) gameManager.armRoomGrace(roomCode);
        else io.to(roomCode).emit('player-disconnected', { roomCode, playerName, players: playersView(room.players) });
        return;
      }
      if (room.isPublic) lobby.publicRoom();
      io.to(roomCode).emit('player-left', { roomCode, playerName, players: playersView(room.players) });
    } catch (err) { /* no-op */ }
  });

  socket.on('disconnect', () => {
    try {
      // Watchers hold no seat, so they just stop watching. Left behind, they'd
      // leak into the watcher counts and keep receiving nothing forever.
      const wasWatching = gameManager.removeSpectator(socketId);
      const wasAnnounced = gameManager.forgetPresence(socketId);
      const t = tournamentManager ? tournamentManager.markDisconnected(socketId) : null;
      if (t) ctx.tournamentSync(t);

      const info = gameManager.markDisconnected(socketId);
      // Only a change the lobby shows is worth a broadcast: most sockets that
      // go away were never announced, watching or seated.
      if (wasWatching || wasAnnounced || info) lobby.refresh();
      if (!info) return;
      const { roomCode, playerName, player } = info;
      const room = gameManager.getRoom(roomCode);
      if (!room) return;

      // Public table still collecting players: hold the seat briefly so a
      // refresh survives, then sweep it so a ghost can't block the table.
      if (room.isPublic && room.status === 'waiting') {
        lobby.publicRoom();
        if (player.sweepTimer) clearTimeout(player.sweepTimer);
        player.sweepTimer = setTimeout(() => {
          player.sweepTimer = null;
          const r = gameManager.getRoom(roomCode);
          // Gone already, started, or they came back.
          if (!r || r.status !== 'waiting' || !r.players.includes(player) || player.connected) return;
          r.players = r.players.filter((p) => p !== player);
          if (r.players.length === 0) gameManager.destroyRoom(roomCode);
          else gameManager._persist(roomCode);
          lobby.publicRoom();
        }, PUBLIC_SEAT_GRACE_MS);
        if (typeof player.sweepTimer.unref === 'function') player.sweepTimer.unref();
        return;
      }
      // Everyone offline at once (server hot-reload, brief wifi outage, all
      // three tabs closed): keep the room in memory for a grace window so
      // any of them can reconnect transparently. The grace timer is
      // cancelled the moment the first player reattaches.
      if (room.players.every((p) => !p.connected)) {
        gameManager.armRoomGrace(roomCode);
        return;
      }
      io.to(roomCode).emit('player-disconnected', { roomCode, playerName, players: playersView(room.players) });
    } catch (err) { /* no-op */ }
  });
}

module.exports = { register };
