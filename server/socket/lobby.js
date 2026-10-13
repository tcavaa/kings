'use strict';

// ─── the lobby ──────────────────────────────────────────────────────────────
// The homepage lists (who's online, live tables, the quick-match tables, open
// tournaments) go to the sockets in the `lobby` channel: everyone, except
// players at a running table and watchers, who don't show them. A socket
// rejoins the channel when the lobby asks for its lists again (`lobby-info`,
// sent whenever the lobby screen opens). Changes are batched: a burst of
// events within LOBBY_BATCH_MS becomes one emit of each list.
//
// Also here: presence, and watching a table from the homepage.

const { playersView, identify } = require('./shared');

const LOBBY = 'lobby';
const LOBBY_BATCH_MS = 250;

function createLobby(io, gameManager, tournamentManager) {
  const lists = {
    online:      (to) => to.emit('online-players', gameManager.onlineView()),
    live:        (to) => to.emit('live-games', gameManager.watchableGames()),
    public:      (to) => to.emit('public-room', gameManager.publicRoomView()),
    tournaments: (to) => tournamentManager && to.emit('tournament-list', tournamentManager.openLobbyViews()),
  };
  const pending = new Set();
  let timer = null;

  function flush() {
    timer = null;
    const kinds = [...pending];
    pending.clear();
    for (const kind of kinds) lists[kind](io.to(LOBBY));
  }

  function schedule(...kinds) {
    kinds.forEach((k) => pending.add(k));
    if (timer) return;
    timer = setTimeout(flush, LOBBY_BATCH_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  return {
    /** Presence or the set of live tables changed. */
    refresh: () => schedule('online', 'live'),
    publicRoom: () => schedule('public'),
    tournaments: () => schedule('tournaments'),
    /** Put a socket (back) in the lobby, optionally sending it lists right away. */
    enter(socket, ...kinds) {
      socket.join(LOBBY);
      for (const kind of kinds) lists[kind](socket);
    },
  };
}

function register(io, socket, ctx, conn) {
  const { gameManager, lobby } = ctx;
  const { socketId, allow, emitError, fail } = conn;

  lobby.enter(socket);

  // Lobby clients ask for the current public-table snapshot on connect.
  socket.on('public-room-info', () => {
    try {
      lobby.enter(socket, 'public');
    } catch (err) { /* no-op */ }
  });

  // ─── presence + public watching ───────────────────────────────────────────
  // Who's online, and which King tables a stranger can drop in on. Announced
  // by the client once it knows which profile it's acting as; the lobby is
  // otherwise invisible to the server because nobody there is in a room.

  socket.on('announce-presence', async (payload = {}) => {
    try {
      if (!allow('presence')) return;
      const me = await identify(socket, payload);
      lobby.enter(socket);
      if (gameManager.announcePresence(socketId, me.name)) lobby.refresh();
    } catch (err) { /* no-op */ }
  });

  // The lobby screen opened: back in the lobby channel, with fresh lists.
  socket.on('lobby-info', () => {
    try {
      lobby.enter(socket, 'online', 'live', 'public');
    } catch (err) { /* no-op */ }
  });

  // Watch any live King table from the homepage. Same masked state and the
  // same socket-room join as tournament spectating — the difference is only
  // who is allowed in and what they may send once there (see canSpeak).
  socket.on('watch-game', async (payload = {}) => {
    try {
      if (!allow('watch')) return;
      const rc = String(payload.roomCode || '').toUpperCase();
      const me = await identify(socket, payload);
      conn.assertNoTournament();
      conn.assertNoTable();
      const room = gameManager.getRoom(rc);
      if (!room) return emitError('That table is no longer available.');
      if (room.status !== 'playing' || !room.gameState) {
        return emitError('That game is not in progress.');
      }

      // Watching a table you're seated at would replace your own hand with a
      // masked state — the same trap the tournament path guards.
      const mapping = gameManager.getMappingBySocketId(socketId);
      if (mapping && mapping.roomCode === rc) {
        return emitError('You are playing at that table.');
      }
      if (gameManager.isSeated(room, me)) {
        return emitError('You are seated at that table.');
      }

      const previous = gameManager.removeSpectator(socketId);
      if (previous && previous.roomCode !== rc) socket.leave(previous.roomCode);

      // No tournamentId: this is a public watcher, so canSpeak stays false.
      gameManager.addSpectator(socketId, rc, { name: me.name, avatar: me.avatar });
      socket.join(rc);
      socket.leave(LOBBY);

      socket.emit('spectate-started', {
        roomCode: rc,
        tournamentId: null,
        startedAt: room.startedAt || null,
        players: playersView(room.players),
        stage: room.tournamentStage || null,
        table: room.tournamentTable ?? null,
      });
      socket.emit('game-state', {
        ...room.gameState.getStateForSpectator(),
        players: playersView(room.players),
      });
      // The lobby's live list counts watchers.
      lobby.refresh();
    } catch (err) { fail(err); }
  });

  socket.on('stop-watching', () => {
    try {
      if (!allow('watch')) return;
      const gone = gameManager.removeSpectator(socketId);
      if (gone) socket.leave(gone.roomCode);
      socket.emit('spectate-stopped');
      lobby.enter(socket);
      lobby.refresh();
    } catch (err) { /* no-op */ }
  });
}

module.exports = { LOBBY, createLobby, register };
