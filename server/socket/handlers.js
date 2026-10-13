'use strict';

const store = require('../db/store');
const { ownsSeat } = require('../game/GameManager');
const { normalizeMode } = require('../lib/util');

const playerView = (p) => ({
  id: p.id, name: p.name, avatar: p.avatar || null, seat: p.seat, connected: p.connected !== false,
});
const playersView = (players = []) => players.map(playerView);

// ─── identity ───────────────────────────────────────────────────────────────
// Who a socket is playing as. With a profile session token (issued by the API
// when the lobby picks a profile, PIN checked) it is that profile: its current
// name and photo, and seats/entries are bound to its id. Without one, a typed
// name is accepted only if no PIN-protected profile uses it. `ownerKey` is the
// browser's own secret (handshake auth, see server/index.js), so a refresh can
// take its seat back but nobody else can.

const SESSION_CACHE_MS = 60 * 1000;
const sessionCache = new Map();   // token -> { profile, at }

function _identityError(message) {
  const err = new Error(message);
  err.code = 'AUTH';
  return err;
}

async function _profileForToken(token) {
  const hit = sessionCache.get(token);
  if (hit && Date.now() - hit.at < SESSION_CACHE_MS) return hit.profile;
  const profile = await store.profileForSession(token);
  if (sessionCache.size > 5000) sessionCache.clear();
  sessionCache.set(token, { profile, at: Date.now() });
  return profile;
}

async function _identify(socket, { profileToken, playerName } = {}) {
  const ownerKey = socket.data.ownerKey || null;
  if (typeof profileToken === 'string' && profileToken) {
    const profile = await _profileForToken(profileToken);
    if (!profile) throw _identityError('Pick your profile again.');
    return { name: profile.name, avatar: profile.avatar, profileId: profile.id, ownerKey };
  }
  const name = typeof playerName === 'string' ? playerName.trim().slice(0, 64) : '';
  if (!name) throw new Error('playerName is required.');
  // A database outage shouldn't stop play — the name just isn't checked then.
  const profile = await store.getProfileByName(name).catch(() => null);
  if (profile?.has_pin) throw _identityError('That profile has a PIN — pick it in the lobby.');
  return { name: profile?.name || name, avatar: profile?.avatar || null, profileId: null, ownerKey };
}

/**
 * True when `playerName` has exhausted today's championship quota, counting
 * league games still being played or not yet saved (the database can't see
 * those). Fails open (returns false) if the DB is unreachable — a broken
 * database should degrade to "can't record games", not "can't play at all".
 */
async function _championshipBlocked(gameManager, playerName) {
  try {
    const quota = await store.getChampionshipQuota(playerName);
    return quota.remaining - gameManager.championshipGamesInFlight(playerName) <= 0;
  } catch (err) {
    console.warn(`[handlers] championship quota check failed for ${playerName}: ${err.message}`);
    return false;
  }
}

// ─── allowed reaction-sound ids ─────────────────────────────────────────────
// The catalogue lives in the `sounds` table (managed from /admin) and only
// changes when an admin adds or removes a clip, so it's cached rather than
// queried on every button press. `play-sound` fires several times a minute
// at a busy table; a DB round-trip per press would be silly.
//
// The seed list below is a frozen fallback — the pre-database catalogue, the
// same clips as supabase/seed.sql and src/online/constants/sounds.js. It is
// never updated: the `sounds` table is the source of truth. It only covers
// two cases: the cache hasn't warmed yet (first press after boot), and the
// DB is unreachable — a database blip should mute nothing.
const SEED_SOUND_IDS = [
  'yeehaw', 'gunshot', 'whistle',
  'giv', 'janmrteloba', 'sheilage', 'shemetxara', 'tsava',
  'Dedofali', 'Male!', 'Revia', 'Tazik',
  '10-10', 'achexet', 'bedi', 'cxado', 'ketika',
];

const SOUND_CACHE_TTL_MS = 60 * 1000;
let soundIdCache = null;
let soundCacheAt = 0;
let soundCacheInFlight = null;

/** Cached set of valid ids. Refreshes in the background; never blocks. */
function allowedSoundIds() {
  const stale = Date.now() - soundCacheAt > SOUND_CACHE_TTL_MS;
  if (stale && !soundCacheInFlight) {
    soundCacheInFlight = store.listSoundIds()
      .then((ids) => {
        // An empty table means the seed migration hasn't run — keep the
        // fallback rather than silencing every button.
        if (ids.length) soundIdCache = new Set(ids);
        soundCacheAt = Date.now();
      })
      .catch((err) => {
        console.warn(`[handlers] sound catalogue refresh failed: ${err.message}`);
        // Back off for a full TTL instead of hammering a downed DB.
        soundCacheAt = Date.now();
      })
      .finally(() => { soundCacheInFlight = null; });
  }
  return soundIdCache || new Set(SEED_SOUND_IDS);
}

/**
 * Who is talking, and where.
 *
 * Chat, voice and sound all used to resolve the sender purely through
 * `socketRoomMap` → `room.players`. A tournament spectator is deliberately in
 * neither, so every one of those handlers silently dropped their messages.
 * Falling back to the spectator registry lets watchers join the conversation
 * without ever becoming a seat in the game.
 *
 * Returns null for a socket that is neither playing nor watching.
 */
function _resolveSpeaker(gameManager, socketId) {
  // Watching is checked FIRST, and the order matters. A spectator is almost
  // always someone whose own table has already finished, and that finished
  // seat is still in socketRoomMap — so resolving the player mapping first
  // sent their messages to the dead table they came from instead of the one
  // they are actually watching. Spectating is the deliberate, current action;
  // the old seat is residue.
  const watcher = gameManager.getSpectator(socketId);
  if (watcher) {
    return {
      roomCode: watcher.roomCode,
      seat: null,               // no seat: the UI must not draw a table bubble
      name: watcher.name,
      avatar: watcher.avatar || null,
      spectator: true,
      // Voice clips and sound buttons are held back from strangers who
      // wandered in off the homepage — that is an audio channel into a game
      // they aren't playing, and there's no accountability behind it. Inside
      // a tournament every watcher is a fellow entrant, so they keep the full
      // set. Text and reactions are open to both.
      canSpeak: !!watcher.tournamentId,
    };
  }

  const mapping = gameManager.getMappingBySocketId(socketId);
  if (mapping) {
    const room = gameManager.getRoom(mapping.roomCode);
    const player = room?.players.find((p) => p.seat === mapping.seat);
    if (player) {
      return {
        roomCode: mapping.roomCode,
        seat: player.seat,
        name: player.name,
        avatar: player.avatar || null,
        spectator: false,
        canSpeak: true,
      };
    }
  }
  return null;
}

// Chat is relayed, never stored, so the server has no message table to point
// a reaction at. A monotonic counter paired with the timestamp gives every
// message a stable id that both ends agree on, which is all a reaction needs.
let _chatSeq = 0;
const _nextMessageId = () => `m${Date.now().toString(36)}${(_chatSeq++).toString(36)}`;

// The tap-back palette. Deliberately a small closed set — clients render
// exactly these, and anything else is dropped on arrival.
const REACTION_EMOJIS = new Set(['😂', '❤️', '😮', '👏', '🔥']);

const CHAMPIONSHIP_LIMIT_MESSAGE =
  `Daily championship limit reached (${store.CHAMPIONSHIP_DAILY_LIMIT} games per day). Play a public game instead.`;

// ─── rate limits ────────────────────────────────────────────────────────────
// [events, per milliseconds] for each kind of event a socket may send. Every
// one of these fans out to a whole table or to every connected socket, so a
// client looping one would multiply traffic by the number of listeners.
// Events over the limit are dropped quietly.
const RATE_LIMITS = {
  sound:      [3, 5000],
  chat:       [5, 5000],
  react:      [10, 5000],
  typing:     [1, 2000],
  voice:      [1, 800],     // about one clip a second
  emoji:      [1, 750],
  presence:   [5, 10000],
  watch:      [6, 10000],
  tournament: [8, 10000],
  join:       [10, 10000],  // create-room, join-room, sit-public, rejoin-public
};

/** A token bucket per kind of event: `allow(kind)` is false when it's empty. */
function rateLimiter(limits = RATE_LIMITS) {
  const buckets = {};
  return function allow(kind) {
    const [capacity, perMs] = limits[kind];
    const now = Date.now();
    const b = buckets[kind] || (buckets[kind] = { tokens: capacity, at: now });
    b.tokens = Math.min(capacity, b.tokens + ((now - b.at) * capacity) / perMs);
    b.at = now;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };
}

// ─── the lobby ──────────────────────────────────────────────────────────────
// The homepage lists (who's online, live tables, the quick-match tables, open
// tournaments) go to the sockets in the `lobby` channel: everyone, except
// players at a running table and watchers, who don't show them. A socket
// rejoins the channel when the lobby asks for its lists again (`lobby-info`,
// sent whenever the lobby screen opens). Changes are batched: a burst of
// events within LOBBY_BATCH_MS becomes one emit of each list.

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

// One context per server: the managers, the lobby and the tournament
// broadcaster are shared by every connection.
const contexts = new WeakMap();

function contextFor(io, gameManager, tournamentManager) {
  let ctx = contexts.get(io);
  if (ctx) return ctx;
  ctx = { io, gameManager, tournamentManager, lobby: createLobby(io, gameManager, tournamentManager) };
  contexts.set(io, ctx);

  // The tournament manager owns bracket logic but does no emitting of its own,
  // so hand it a broadcaster built from the helpers that live here.
  if (tournamentManager) tournamentManager.attach(_makeTournamentBroadcaster(ctx));

  // A socket took a seat somewhere else: it stops hearing its old room, and
  // the old room hears that it left (or, mid-game, went offline).
  gameManager.on('socket-detached', ({ socketId, roomCode, room, playerName, removed, watchedRoomCode }) => {
    if (watchedRoomCode) io.in(socketId).socketsLeave(watchedRoomCode);
    if (!roomCode) return;
    io.in(socketId).socketsLeave(roomCode);
    if (room && removed) {
      io.to(roomCode).emit('player-left', { roomCode, playerName, players: playersView(room.players) });
    } else if (room && room.status === 'playing') {
      io.to(roomCode).emit('player-disconnected', { roomCode, playerName, players: playersView(room.players) });
    }
    if (!room || room.isPublic) ctx.lobby.publicRoom();
    ctx.lobby.refresh();
  });

  // A room was dropped from memory while people were still watching it.
  gameManager.on('room-expired', ({ roomCode, watchers }) => {
    for (const watcherId of watchers) {
      io.in(watcherId).socketsLeave(roomCode);
      io.to(watcherId).emit('spectate-stopped', { reason: 'closed' });
    }
    ctx.lobby.refresh();
  });

  return ctx;
}

function registerHandlers(io, socket, gameManager, tournamentManager) {
  const ctx = contextFor(io, gameManager, tournamentManager);
  const { lobby } = ctx;
  const socketId = socket.id;
  const allow = rateLimiter();

  lobby.enter(socket);

  // Warm the catalogue on connect. Without this the first `play-sound` of a
  // server's life is checked against the seed fallback (the refresh it
  // kicks off only lands afterwards), so a freshly-uploaded clip would be
  // silently dropped once. A connect always precedes a button press.
  allowedSoundIds();

  function emitError(message, code) { socket.emit('error', { message, code }); }
  const fail = (err) => emitError(err.message, err.code);
  const championshipBlocked = (name) => _championshipBlocked(gameManager, name);

  // One table at a time per socket: a homepage seat and a tournament entry
  // would both point this socket's room mapping at different games, and one
  // of the two tables would stall.

  /** The waiting or running room this socket sits at, if any. */
  function _tableOf() {
    const mapping = gameManager.getMappingBySocketId(socketId);
    const room = mapping && gameManager.getRoom(mapping.roomCode);
    return room && (room.status === 'waiting' || room.status === 'playing') ? room : null;
  }

  /**
   * The tournament that may still seat this socket: any stage up to the end
   * of the semifinals (finalists are only known then), and the final for
   * the finalists.
   */
  function _tournamentOf() {
    const t = tournamentManager?.findBySocket(socketId);
    if (!t || t.status !== 'final') return t || null;
    const entry = t.players.find((p) => p.id === socketId);
    const final = gameManager.getRoom(t.finalRoomCode);
    return final && final.status === 'playing' && final.players.some((p) => ownsSeat(p, entry)) ? t : null;
  }

  /** Refuse a new table while the socket is in a tournament (its own tables excepted). */
  function _assertNoTournament(roomCode) {
    const t = _tournamentOf();
    if (t && !(roomCode && gameManager.getRoom(roomCode)?.tournamentId === t.id)) {
      throw new Error('You are in a tournament — leave it first.');
    }
  }

  /** Refuse a tournament while the socket sits at another table. */
  function _assertNoTable(tournamentId) {
    const room = _tableOf();
    if (room && !(tournamentId && room.tournamentId === tournamentId)) {
      throw new Error('You are at a table — leave it first.');
    }
  }
  function emitChampionshipLimit() { emitError(CHAMPIONSHIP_LIMIT_MESSAGE, 'CHAMPIONSHIP_LIMIT'); }

  /**
   * The seat this socket plays, for the game actions. Reports the error and
   * returns null when there's none (or, with needGame, no game yet).
   */
  function seatOf({ needGame = true } = {}) {
    const mapping = gameManager.getMappingBySocketId(socketId);
    if (!mapping) { emitError('You are not in a room.'); return null; }
    const room = gameManager.getRoom(mapping.roomCode);
    if (!room) { emitError('Room not found.'); return null; }
    if (needGame && !room.gameState) { emitError('Game not found.'); return null; }
    return { roomCode: mapping.roomCode, seat: mapping.seat, room, gs: room.gameState };
  }

  /** A socket handler that runs `fn(seat, payload)` for a seated player. */
  function withSeat(fn, options) {
    return (payload = {}) => {
      try {
        const at = seatOf(options);
        if (at) fn(at, payload || {});
      } catch (err) {
        fail(err);
      }
    };
  }

  /** A room just got its third player: homepage tables start on their own. */
  function _maybeAutoStart(room) {
    if (!room || !room.isPublic || room.status !== 'waiting' || room.players.length !== 3) return;
    const gameState = gameManager.startGame(room.code);
    _emitGameStart(ctx, room, gameState);
    // Free the homepage seats for the next trio. The trio has just left the
    // lobby channel, so they get the cleared view directly.
    gameManager.clearPublicRoom(room.code);
    io.to(room.code).emit('public-room', gameManager.publicRoomView());
    lobby.publicRoom();
  }

  // ─── create-room ─────────────────────────────────────────────────────────
  socket.on('create-room', async (payload = {}) => {
    try {
      if (!allow('join')) return;
      const me = await _identify(socket, payload);
      _assertNoTournament();
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
      const me = await _identify(socket, payload);

      const rc = roomCode.toUpperCase().slice(0, 16);
      // If the room isn't currently in memory (e.g. server restarted while the
      // game was live), look it up in the database and rehydrate before joining.
      // This is the rejoin recovery path.
      if (!gameManager.getRoom(rc)) {
        await gameManager.tryLoadFromDB(rc);
      }
      _assertNoTournament(rc);

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
        _emitReconnected(rc, seat, me);
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
        _maybeAutoStart(room);
      }
    } catch (err) {
      fail(err);
    }
  });

  /**
   * Back in an existing seat (a reconnect). `room-joined` tells the client
   * which screen to land on; at a bracket table the tournament entry follows
   * the new socket too, or the final would be seated on the dead one.
   */
  function _emitReconnected(rc, seat, me) {
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
  }

  // ─── public quick-match room ──────────────────────────────────────────────

  // Lobby clients ask for the current public-table snapshot on connect.
  socket.on('public-room-info', () => {
    try {
      lobby.enter(socket, 'public');
    } catch (err) { /* no-op */ }
  });

  // Sit at one of the homepage quick-match tables ('public' by default,
  // 'championship' when requested). The sitter stays on the homepage — no
  // waiting-room redirect — until the 3rd seat fills, at which point the
  // game starts automatically for all three and the table's slot resets.
  socket.on('sit-public', async (payload = {}) => {
    try {
      if (!allow('join')) return;
      const me = await _identify(socket, payload);
      _assertNoTournament();
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
        socketId, me, _sanitizeEmoji(payload.emoji), tableMode
      );
      socket.join(roomCode);
      socket.emit('public-seated', { roomCode, seat, mode: tableMode });
      lobby.publicRoom();
      _maybeAutoStart(gameManager.getRoom(roomCode));
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
      const next = _sanitizeEmoji(emoji);
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
      const me = await _identify(socket, payload);
      if (!room || !gameManager.isSeated(room, me)) return socket.emit('public-rejoin-failed');
      const { seat, status } = gameManager.joinRoom(rc, socketId, me);
      socket.join(rc);
      if (status === 'waiting') {
        socket.emit('public-seated', { roomCode: rc, seat, mode: room.mode || 'public' });
        lobby.publicRoom();
      } else {
        _emitReconnected(rc, seat, me);
      }
    } catch (err) {
      socket.emit('public-rejoin-failed');
    }
  });

  // ─── start-game ──────────────────────────────────────────────────────────
  socket.on('start-game', withSeat(({ roomCode, seat, room }) => {
    // A second tap after the game started has nothing left to do.
    if (room.status !== 'waiting') return;
    if (seat !== 0) return emitError('Only the room creator can start the game.');
    const gameState = gameManager.startGame(roomCode);
    _emitGameStart(ctx, room, gameState);
  }, { needGame: false }));

  // The decision phases below ignore a repeated tap once the phase has moved
  // on (a double tap, or a tap that crossed the server's answer): there is
  // nothing to tell the player that their screen won't show anyway.

  // ─── select-game-type ─────────────────────────────────────────────────────
  socket.on('select-game-type', withSeat(({ roomCode, seat, gs }, { typeCode }) => {
    if (gs.phase !== 'type_selection') return;
    if (seat !== gs.leaderSeat) return emitError('Only the leader can select the game type.');
    if (!typeCode) return emitError('typeCode is required.');
    const result = gameManager.handleSelectGameType(roomCode, seat, typeCode);
    if (!result.ok) return emitError(result.error);
    io.to(roomCode).emit('game-type-selected', {
      typeCode,
      leaderSeat: gs.leaderSeat,
      phase: gs.phase,
      usedTypes: { ...gs.usedTypes },
      version: gs.version,
    });
    // Send updated hand to leader. For non-trump types the 2 center cards
    // have already been merged in; for Pluses (trump_selection phase) the
    // merge is deferred until selectTrump(), so the hand here is still 10.
    socket.emit('hand-updated', {
      hand: gs.hands[seat],
      lastCenterCards: gs.lastCenterCards,
    });
  }));

  // ─── select-trump (for Pluses only) ───────────────────────────────────────
  socket.on('select-trump', withSeat(({ roomCode, seat, gs }, { suit }) => {
    if (gs.phase !== 'trump_selection') return;
    const result = gameManager.handleSelectTrump(roomCode, seat, suit);
    if (!result.ok) return emitError(result.error);
    io.to(roomCode).emit('trump-selected', {
      trumpSuit: gs.trumpSuit,
      phase: gs.phase,
      leaderSeat: gs.leaderSeat,
      version: gs.version,
    });
    // The 2 center cards have just been merged into the leader's hand —
    // send the updated hand + which cards came from center for highlighting.
    socket.emit('hand-updated', {
      hand: gs.hands[seat],
      lastCenterCards: gs.lastCenterCards,
    });
  }));

  // ─── discard-cards ────────────────────────────────────────────────────────
  socket.on('discard-cards', withSeat(({ roomCode, seat, gs }, { cards }) => {
    if (gs.phase !== 'discard') return;
    if (!Array.isArray(cards) || cards.length !== 2) return emitError('Must provide exactly 2 cards to discard.');
    const result = gameManager.handleDiscardCards(roomCode, seat, cards);
    if (!result.ok) return emitError(result.error);
    socket.emit('hand-updated', { hand: gs.hands[seat] });
    io.to(roomCode).emit('cards-discarded', {
      phase: gs.phase,
      currentTurn: gs.currentTurn,
      leaderSeat: gs.leaderSeat,
      version: gs.version,
    });
  }));

  // ─── play-card ────────────────────────────────────────────────────────────
  socket.on('play-card', withSeat(({ roomCode, seat, room, gs }, { card }) => {
    const result = gameManager.handlePlayCard(roomCode, seat, card);
    if (!result.ok) return emitError(result.error);
    const cardCounts = gs.cardCounts();

    if (!result.trickComplete) {
      io.to(roomCode).emit('card-played', {
        seat,
        card: result.card,
        currentTrick: gs.currentTrick,
        currentTurn: gs.currentTurn,
        ledSuit: gs.ledSuit,
        cardCounts,
        version: gs.version,
      });
      return;
    }

    if (!result.roundEnds) {
      io.to(roomCode).emit('trick-complete', {
        winnerSeat: result.winnerSeat,
        trick: result.trick,
        roundEnds: false,
        trickNumber: gs.trickNumber,
        nextTurn: gs.currentTurn,
        tricksTaken: { ...gs.tricksTaken },
        cardCounts,
        version: gs.version,
      });
      return;
    }

    // Round complete — a pending quit/surrender vote is moot now; drop it
    // so voters' dialogs don't linger into the next round.
    _clearQuitProposal(room);
    _emitRoundComplete(ctx, room, result, { winnerSeat: result.winnerSeat, trick: result.trick });
  }));

  // ─── next-round ───────────────────────────────────────────────────────────
  socket.on('next-round', withSeat(({ roomCode, room, gs }) => {
    if (gs.phase !== 'round_end') return;
    const gameState = gameManager.handleNextRound(roomCode, socketId);
    _clearQuitProposal(room);
    io.to(roomCode).emit('round-started', {
      round: gameState.round,
      leaderSeat: gameState.leaderSeat,
      phase: gameState.phase,
      usedTypes: { ...gameState.usedTypes },
      // Watchers get no `hand-dealt`, so the fresh card counts come here.
      cardCounts: gameState.cardCounts(),
      version: gameState.version,
    });
    _emitHandDealt(io, room, gameState, roomCode);
  }));

  // ─── play-sound ───────────────────────────────────────────────────────────
  // The player who emits this is "playing a sound at" `targetSeat` (which is
  // typically themselves). All players in the room receive the broadcast and
  // play the clip matching `soundId`. Server only validates the id against
  // the `sounds` catalogue (see allowedSoundIds).
  socket.on('play-sound', ({ soundId, targetSeat } = {}) => {
    try {
      if (!allowedSoundIds().has(soundId)) return;
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who || !who.canSpeak) return;
      // A spectator has no avatar on the felt, so a sound they fire has to
      // name the seat it pops over explicitly; without one there's nowhere to
      // draw the bubble and it's dropped.
      const target = Number.isInteger(targetSeat) && targetSeat >= 0 && targetSeat <= 2
        ? targetSeat
        : who.seat;
      if (target === null || target === undefined) return;
      if (!allow('sound')) return;
      io.to(who.roomCode).emit('play-sound', {
        soundId,
        bySeat: who.seat,
        spectator: who.spectator,
        targetSeat: target,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── propose-quit ─────────────────────────────────────────────────────────
  // A player asks to end the current round early (`kind: 'round'`) or to
  // surrender the whole game (`kind: 'game'`). Both other players must accept
  // via `vote-quit` before anything happens; a single decline (or the 30s
  // expiry) kills the proposal and play continues untouched.
  socket.on('propose-quit', (payload = {}) => {
    const { kind } = payload || {};
    if (kind !== 'round' && kind !== 'game') return emitError('Invalid proposal.');
    withSeat(({ roomCode, seat, room, gs }) => {
      if (room.status !== 'playing') return emitError('Game is not in progress.');
      if (kind === 'round' && !(gs.chosenGameType && (gs.phase === 'discard' || gs.phase === 'playing'))) {
        return emitError('The round cannot be quit right now.');
      }
      if (room.quitProposal) return emitError('Another proposal is already waiting on votes.');

      const proposal = {
        kind,
        proposerSeat: seat,
        accepted: new Set([seat]),
        timer: setTimeout(() => {
          if (room.quitProposal !== proposal) return;
          // Someone who was only briefly away may have counted as present
          // when the vote opened and be gone by now.
          if (_settleQuitProposal(ctx, room, roomCode)) return;
          room.quitProposal = null;
          io.to(roomCode).emit('quit-rejected', { kind, proposerSeat: seat, reason: 'timeout' });
        }, QUIT_VOTE_MS),
      };
      if (typeof proposal.timer.unref === 'function') proposal.timer.unref();
      room.quitProposal = proposal;

      if (!_settleQuitProposal(ctx, room, roomCode)) _emitQuitProposal(io, room, roomCode);
    })(payload);
  });

  // ─── vote-quit ────────────────────────────────────────────────────────────
  socket.on('vote-quit', withSeat(({ roomCode, seat, room }, { accept }) => {
    const proposal = room.quitProposal;
    if (!proposal) return emitError('No proposal is waiting on votes.');
    if (seat === proposal.proposerSeat) return emitError('You proposed this — the other players must vote.');
    const { kind, proposerSeat } = proposal;

    if (!accept) {
      _clearQuitProposal(room);
      io.to(roomCode).emit('quit-rejected', { kind, proposerSeat, voterSeat: seat, reason: 'declined' });
      return;
    }

    proposal.accepted.add(seat);
    // Not everyone present has agreed yet — rebroadcast so every UI updates.
    if (!_settleQuitProposal(ctx, room, roomCode)) _emitQuitProposal(io, room, roomCode);
  }));

  // ─── chat-typing ──────────────────────────────────────────────────────────
  // Lightweight presence ping: relayed to everyone else in the room so their
  // chat drawer / table avatars can show a "typing…" indicator. The client
  // throttles emission and expires the indicator on its own timer, so the
  // server just forwards.
  socket.on('chat-typing', () => {
    try {
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who || !allow('typing')) return;
      socket.to(who.roomCode).emit('chat-typing', {
        seat: who.seat, spectator: who.spectator, at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── voice-message ────────────────────────────────────────────────────────
  // Ephemeral voice clips: the binary payload is relayed as-is to everyone
  // in the sender's room and never stored — only players connected at that
  // moment hear it (a refresh loses history, same as chat bubbles).
  // Size-capped and rate-limited so the pipe can't be flooded. Only real
  // binary counts: anything else could claim a small `length` and carry more.
  socket.on('voice-message', ({ audio, mime, duration } = {}) => {
    try {
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who || !who.canSpeak) return;
      const binary = Buffer.isBuffer(audio) || audio instanceof ArrayBuffer || ArrayBuffer.isView(audio);
      if (!binary || !audio.byteLength || audio.byteLength > MAX_VOICE_BYTES) return;
      if (mime !== undefined && !(typeof mime === 'string' && VOICE_MIME_RE.test(mime))) return;
      if (!allow('voice')) return;
      const now = Date.now();
      io.to(who.roomCode).emit('voice-message', {
        id: _nextMessageId(),
        seat: who.seat,
        spectator: who.spectator,
        name: who.name,
        avatar: who.avatar,
        audio,
        mime: mime || 'audio/webm',
        duration: Math.min(Math.max(Number(duration) || 0, 0), 30),
        at: now,
      });
    } catch (err) { /* no-op */ }
  });

  // ─── chat-message ─────────────────────────────────────────────────────────
  socket.on('chat-message', ({ message } = {}) => {
    try {
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who) return;
      if (typeof message !== 'string') return;
      const trimmed = message.trim().slice(0, 240);
      if (!trimmed || !allow('chat')) return;
      io.to(who.roomCode).emit('chat-message', {
        id: _nextMessageId(),
        seat: who.seat,
        spectator: who.spectator,
        name: who.name,
        avatar: who.avatar,
        message: trimmed,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

  // ─── chat-react ───────────────────────────────────────────────────────────
  // Tap-back on a chat message. Relayed, not stored: chat history itself is a
  // 50-message in-memory window that a refresh clears, so persisting the
  // reactions would outlive the messages they belong to. The server doesn't
  // know which ids are real either — it just fans out to the room and lets
  // each client match the id against what it is holding.
  //
  // `emoji` is checked against a fixed set rather than sanitised: an open
  // string here would be a second chat channel.
  socket.on('chat-react', ({ messageId, emoji } = {}) => {
    try {
      const who = _resolveSpeaker(gameManager, socketId);
      if (!who) return;
      if (typeof messageId !== 'string' || !messageId || messageId.length > 40) return;
      if (!REACTION_EMOJIS.has(emoji) || !allow('react')) return;
      io.to(who.roomCode).emit('chat-reaction', {
        messageId,
        emoji,
        seat: who.seat,
        name: who.name,
        spectator: who.spectator,
        at: Date.now(),
      });
    } catch (err) { /* no-op */ }
  });

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

  // ─── request-state ────────────────────────────────────────────────────────
  // Background resync only — every caller is a watchdog (turn timeout, tab
  // regained focus, rejected play), never a user action. Nothing here is
  // worth a toast, and emitting one from the `error` handler's own retry
  // path could ping-pong, so every failure mode exits quietly.
  //
  // A client that sends the `version` of the state it holds (every game event
  // carries one) gets a short `state-current` when nothing has changed,
  // instead of the whole table.
  socket.on('request-state', (payload) => {
    try {
      const known = payload && Number.isInteger(payload.version) ? payload.version : null;
      // A watcher has no seat: answer with the masked view of the table they
      // watch. Checked first — a watcher's old, finished seat may still map.
      const watching = gameManager.getSpectator(socketId);
      const mapping = watching ? null : gameManager.getMappingBySocketId(socketId);
      const room = gameManager.getRoom(watching ? watching.roomCode : mapping?.roomCode);
      // No state yet is the normal condition for a seat in a waiting room —
      // the tab-visibility watchdog fires `request-state` for anyone with a
      // room code. Nothing to sync, nothing to say.
      if (!room || !room.gameState) return;
      const gs = room.gameState;
      if (known === gs.version) return socket.emit('state-current', { version: gs.version });
      const state = watching ? gs.getStateForSpectator() : gs.getStateForPlayer(mapping.seat);
      // Include the room roster (with avatars) — the game state carries none.
      socket.emit('game-state', { ...state, players: playersView(room.players) });
    } catch (err) { /* no-op */ }
  });

  // ─── presence + public watching ───────────────────────────────────────────
  // Who's online, and which King tables a stranger can drop in on. Announced
  // by the client once it knows which profile it's acting as; the lobby is
  // otherwise invisible to the server because nobody there is in a room.

  socket.on('announce-presence', async (payload = {}) => {
    try {
      if (!allow('presence')) return;
      const me = await _identify(socket, payload);
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
      const me = await _identify(socket, payload);
      _assertNoTournament();
      _assertNoTable();
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

  // ─── tournament ───────────────────────────────────────────────────────────
  // A tournament is a lobby that fills to exactly 6 or 9, splits at random
  // into 3-player King tables, and feeds three finalists into one last table.
  // Everyone entered also sits in a socket room named after the tournament id
  // so roster and bracket updates reach them wherever they are.
  const tournamentSync = (t) => _tournamentSync(ctx, t);

  socket.on('tournament-create', async (payload = {}) => {
    try {
      if (!tournamentManager) return emitError('Tournaments are unavailable.');
      if (!allow('tournament')) return;
      const me = await _identify(socket, payload);
      _assertNoTable();
      const t = tournamentManager.create(socketId, me, payload.size);
      socket.join(t.id);
      socket.emit('tournament-joined', tournamentManager.lobbyView(t));
      tournamentSync(t);
    } catch (err) { fail(err); }
  });

  // Entering a lobby, or coming back to an entry after a refresh or a socket
  // blip — in which case a player whose bracket is already running is seated
  // back at their live table.
  socket.on('tournament-join', async (payload = {}) => {
    try {
      if (!tournamentManager) return emitError('Tournaments are unavailable.');
      if (!allow('tournament')) return;
      const me = await _identify(socket, payload);
      _assertNoTable(tournamentManager.findByCode(payload.code)?.id);
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
          _emitReconnected(rc, seat, me);
        }
        tournamentSync(t);
        return;
      }
      tournamentSync(t);
      // The draw happens the moment the last seat is taken.
      if (tournamentManager.isFull(t)) {
        tournamentManager.startSemifinal(t);
        tournamentSync(t);
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
      if (res.tournament) tournamentSync(res.tournament);
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
  socket.on('tournament-overview', () => {
    try {
      if (!tournamentManager) return;
      const mapping = gameManager.getMappingBySocketId(socketId);
      const t = tournamentManager.findBySocket(socketId)
        || (mapping ? tournamentManager.findByRoom(mapping.roomCode) : null);
      if (!t) return;
      socket.emit('tournament-overview', tournamentManager.overview(t));
    } catch (err) { /* no-op */ }
  });

  // Watch another table. Safe by construction: every hand-bearing emit in
  // this file is addressed to a specific player socket (`io.to(player.id)`),
  // never to the room, so joining the room channel exposes only the shared
  // action — cards played, tricks, scores. The one thing a watcher would
  // otherwise miss is the current state, and that goes through the masked
  // `getStateForSpectator()`.
  socket.on('tournament-spectate', async (payload = {}) => {
    try {
      if (!tournamentManager) return;
      if (!allow('watch')) return;
      const rc = String(payload.roomCode || '').toUpperCase();
      const me = await _identify(socket, payload);
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
      if (t) tournamentSync(t);

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

// How long a quit/surrender proposal waits for votes before auto-expiring.
const QUIT_VOTE_MS = 30 * 1000;

// Hard cap on a relayed voice clip (≈15s of Opus fits well under this).
const MAX_VOICE_BYTES = 400 * 1024;
const VOICE_MIME_RE = /^audio\/[\w.+-]+(;[\w=.+ -]*)?$/;

// How long a disconnected player keeps their public-table seat before it's
// swept and offered to the next sitter (long enough to survive a refresh).
const PUBLIC_SEAT_GRACE_MS = 30 * 1000;

// Reaction emojis are client-chosen; the server just caps them to something
// emoji-sized so nothing longer sneaks into the broadcast.
function _sanitizeEmoji(emoji) {
  if (typeof emoji !== 'string') return null;
  const trimmed = emoji.trim();
  if (!trimmed || trimmed.length > 8) return null;
  return trimmed;
}

// A player who has been disconnected this long no longer has to vote: the
// players still at the table can quit the round or end the game without them.
const GONE_MS = Number(process.env.QUIT_GONE_MS) || 20 * 1000;  // env: tests only

/** Seats that must agree to a quit/surrender: everyone not gone for good. */
function _quitVoters(room) {
  const now = Date.now();
  return room.players
    .filter((p) => p.connected || !p.leftAt || now - p.leftAt < GONE_MS)
    .map((p) => p.seat);
}

function _emitQuitProposal(io, room, roomCode) {
  const { kind, proposerSeat, accepted } = room.quitProposal;
  io.to(roomCode).emit('quit-proposal', {
    kind,
    proposerSeat,
    proposerName: room.players.find((p) => p.seat === proposerSeat)?.name || `Player ${proposerSeat}`,
    acceptedSeats: [...accepted].sort((a, b) => a - b),
    voters: _quitVoters(room),
  });
}

/**
 * Carry out the pending quit/surrender once every player still present has
 * agreed. Ending the game this way makes the highest score the winner, the
 * same as a surrender. Returns true when it ran.
 */
function _settleQuitProposal(ctx, room, roomCode) {
  const { io, gameManager } = ctx;
  const proposal = room.quitProposal;
  if (!proposal) return false;
  const voters = _quitVoters(room);
  if (!voters.every((seat) => proposal.accepted.has(seat))) return false;
  const { kind, proposerSeat } = proposal;
  const goneSeats = room.players.map((p) => p.seat).filter((seat) => !voters.includes(seat));
  _clearQuitProposal(room);

  if (kind === 'game') {
    _finishGame(ctx, room, roomCode,
      goneSeats.length ? { abandonedSeats: goneSeats } : { surrenderedBySeat: proposerSeat });
    return true;
  }

  const result = gameManager.handleQuitRound(roomCode, proposerSeat);
  if (!result.ok) {
    // The round moved on while votes were coming in (e.g. it ended
    // naturally) — tell everyone the proposal fizzled.
    io.to(roomCode).emit('quit-rejected', { kind, proposerSeat, reason: 'timeout' });
    return true;
  }
  _emitRoundComplete(ctx, room, result, { winnerSeat: null, trick: null, quitBySeat: proposerSeat });
  return true;
}

function _clearQuitProposal(room) {
  if (!room || !room.quitProposal) return;
  if (room.quitProposal.timer) clearTimeout(room.quitProposal.timer);
  room.quitProposal = null;
}

/** A round just ended (played out or quit): tell the table, and finish the game after round 27. */
function _emitRoundComplete(ctx, room, result, extra) {
  const gs = room.gameState;
  ctx.io.to(room.code).emit('round-complete', {
    ...extra,
    roundEnds: true,
    scores: result.scores,
    cumulativeScores: result.cumulativeScores,
    round: result.round,
    gameType: result.gameType,
    isGameOver: result.isGameOver,
    cardCounts: gs.cardCounts(),
    roundDetail: gs.roundDetails[gs.roundDetails.length - 1],
    version: gs.version,
  });
  if (result.isGameOver) _finishGame(ctx, room, room.code);
}

/**
 * Shared game-over path: rank the cumulative scores, broadcast `game-over`,
 * flip the room to finished, and arm the grace timer so the room survives
 * long enough for "Play Again" clicks. `extra` is merged into the payload
 * (e.g. `surrenderedBySeat` when the game ended via a surrender vote).
 * The room is intentionally NOT destroyed here — see the rematch flow.
 */
function _finishGame(ctx, room, roomCode, extra = {}) {
  const { io, gameManager, tournamentManager } = ctx;
  const gs = room.gameState;

  const finalScores = { ...gs.cumulativeScores };
  let bestScore = null;
  for (let s = 0; s < 3; s++) {
    if (bestScore === null || finalScores[s] > bestScore) {
      bestScore = finalScores[s];
    }
  }
  // Everyone on the top score is a winner — a tie crowns them all. `winner`
  // (the lowest-seat one) is kept alongside `winners` for older consumers.
  const winners = [0, 1, 2]
    .filter((s) => finalScores[s] === bestScore)
    .map((s) => ({
      seat: s,
      name: room.players.find((p) => p.seat === s)?.name || 'Unknown',
      score: bestScore,
    }));
  const winner = winners[0];
  const isTie = winners.length > 1;
  const mode = normalizeMode(room.mode);

  // The game server is the only writer of King Online results. The id is
  // derived from the room and the final scores, so a retry can't double-save.
  // Until the save lands, the daily quota counts the game from memory (see
  // GameManager.championshipGamesInFlight).
  const scorePart = [0, 1, 2]
    .map((s) => finalScores[s] ?? 0)
    .join('.')
    .replace(/-/g, 'n');
  const gameId = `g_${roomCode}_${winner.seat}_${scorePart}`;
  room.saved = false;
  _saveWithRetry(gameId, {
    id: gameId,
    players: room.players.map((p) => ({
      seat: p.seat, name: p.name, avatar: p.avatar || null,
      score: finalScores[p.seat] ?? 0,
    })),
    winner,
    winners,
    isChampionship: mode === 'championship',
    // Bracket tables are league games that don't use up the daily quota.
    tournamentId: room.tournamentId || null,
    roundDetails: gs.roundDetails || [],
  }).then((saved) => { if (saved) room.saved = true; });

  gs.finish();
  room.status = 'finished';
  io.to(roomCode).emit('game-over', {
    finalScores,
    winner,
    winners,
    isTie,
    mode,
    players: playersView(room.players),
    roundDetails: gs.roundDetails,
    version: gs.version,
    ...extra,
  });

  // Send the watchers home. The table they came to see is done, and leaving
  // them attached would leave them showing as "watching" a finished game with
  // no way back to the lobby.
  for (const watcherId of gameManager.evictSpectators(roomCode)) {
    io.in(watcherId).socketsLeave(roomCode);
    io.to(watcherId).emit('spectate-stopped', { reason: 'game-over' });
  }
  ctx.lobby.refresh();

  // A tagged table feeds the bracket: recording the last semifinal result is
  // what draws the finalists and opens the final.
  if (room.tournamentId && tournamentManager) {
    try {
      tournamentManager.reportResult(roomCode, {
        winners,
        finalScores,
        players: playersView(room.players),
        roundDetails: gs.roundDetails || [],
      });
    } catch (err) {
      console.warn(`[handlers] tournament report for ${roomCode} failed: ${err.message}`);
    }
  }

  gameManager.armRoomGrace(roomCode);
  // The result is in `finished_games` now — drop the live snapshot. The room
  // itself stays in memory for the rematch grace window.
  gameManager.retireRoom(roomCode);
}

const SAVE_RETRY_MS = [2000, 10000, 30000];

/** Save a finished game, retrying a failure. Resolves true once it's saved. */
function _saveWithRetry(gameId, record, attempt = 0) {
  return store.saveFinishedGame(record).then(() => true, (err) => {
    if (attempt >= SAVE_RETRY_MS.length) {
      console.error(`[handlers] saving finished game ${gameId} failed for good: ${err.message}`);
      return false;
    }
    console.warn(`[handlers] saving finished game ${gameId} failed (${err.message}) — retrying`);
    return new Promise((resolve) => {
      const t = setTimeout(() => resolve(_saveWithRetry(gameId, record, attempt + 1)), SAVE_RETRY_MS[attempt]);
      if (typeof t.unref === 'function') t.unref();
    });
  });
}

/** A tournament's roster changed: its entrants hear it, and the lobby's list follows. */
function _tournamentSync(ctx, t) {
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
function _makeTournamentBroadcaster(ctx) {
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

      _emitGameStart(ctx, room, gameState);
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },

    overviewChanged(t) {
      io.to(t.id).emit('tournament-overview', overviewOf(t));
    },

    /** An entrant left a lobby, or was dropped for staying away. */
    lobbyChanged({ tournament }) {
      if (tournament) _tournamentSync(ctx, tournament);
      else ctx.lobby.tournaments();
    },

    finalStarted(t, roomCode, finalists) {
      io.to(t.id).emit('tournament-state', tournamentManager.lobbyView(t));
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
      io.to(t.id).emit('tournament-state', tournamentManager.lobbyView(t));
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

/**
 * A game just started at `room`: everyone gets the table and their hand, and
 * the players leave the lobby channel (they don't show its lists) while the
 * lobby learns there's a new live table.
 */
function _emitGameStart(ctx, room, gameState) {
  const { io } = ctx;
  io.to(room.code).emit('game-started', {
    round: gameState.round,
    leaderSeat: gameState.leaderSeat,
    players: playersView(room.players),
    startedAt: room.startedAt || null,
    version: gameState.version,
  });
  _emitHandDealt(io, room, gameState, room.code);
  io.in(room.code).socketsLeave(LOBBY);
  ctx.lobby.refresh();
}

function _emitHandDealt(io, room, gameState, roomCode) {
  const cardCounts = gameState.cardCounts();
  for (const player of room.players) {
    if (!player.id || !player.connected) continue;
    const isLeader = player.seat === gameState.leaderSeat;
    io.to(player.id).emit('hand-dealt', {
      // Every round (including the 1st): players see their own hand right
      // away, and non-leaders see the 2 prikup cards while the leader is
      // choosing. Only the leader is kept blind to the prikup until it's
      // merged into their hand.
      hand: gameState.hands[player.seat],
      centerCards: isLeader ? [] : gameState.centerCards,
      leaderSeat: gameState.leaderSeat,
      round: gameState.round,
      cardCounts,
      version: gameState.version,
    });
  }
}

module.exports = registerHandlers;
