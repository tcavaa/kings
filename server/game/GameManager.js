'use strict';

const GameState = require('./GameState');
const store     = require('../db/store');

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// How long an entirely-empty (all players disconnected) room is kept alive
// in memory before being garbage-collected. The persisted `live_games` row
// also covers crash recovery, but holding the room in memory means a quick
// network blip (mobile wifi switching cells, server hot-reload, etc.) never
// drops the table state — the rejoining player just reattaches to the same
// in-memory room. The database snapshot is the long-term backup; the timer is
// the short-term one.
const ROOM_GRACE_MS = 90 * 1000;

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

/**
 * Whether `identity` (see handlers' `_identify`) may take over a seat row: the
 * same verified profile, or the same browser. A name alone is never enough —
 * every visitor can see who sits at which table.
 */
function ownsSeat(row, identity) {
  if (!row || !identity) return false;
  return !!((identity.profileId && row.profileId === identity.profileId)
    || (identity.ownerKey && row.ownerKey === identity.ownerKey));
}

/** The seat row for this identity's profile, else for its name. */
function findSeat(players, identity) {
  return players.find((p) => identity.profileId && p.profileId === identity.profileId)
    || players.find((p) => sameName(p.name, identity.name));
}

function seatRow(socketId, identity, seat) {
  return {
    id: socketId,
    name: identity.name,
    avatar: identity.avatar || null,
    seat,
    connected: true,
    profileId: identity.profileId || null,
    ownerKey: identity.ownerKey || null,
  };
}

class GameManager {
  constructor() {
    this.rooms = new Map();
    this.socketRoomMap = new Map();
    // roomCode -> Timeout: pending "delete if still empty" job.
    this.roomGraceTimers = new Map();
    // The homepage quick-match rooms currently collecting players — one per
    // game mode. Cleared the moment a table's game starts (or the room dies)
    // so the next sitter opens a fresh table. In-memory only.
    this.quickMatchCodes = { public: null, championship: null };
    // Watchers, not players. Kept out of `rooms[].players` so nothing in the
    // game engine can ever deal to them or count them toward a seat, but
    // tracked here so the chat/voice handlers can still identify them —
    // those all resolve a sender via socketRoomMap, which a spectator is
    // deliberately absent from.
    this.spectators = new Map();   // socketId -> { roomCode, tournamentId, name, avatar }
    // Everyone currently on the site, table or not. socketId -> { name, since }
    this.presence = new Map();
  }

  // ── spectators ────────────────────────────────────────────────────────────

  addSpectator(socketId, roomCode, info = {}) {
    this.spectators.set(socketId, {
      roomCode,
      tournamentId: info.tournamentId || null,
      name: info.name || 'Spectator',
      avatar: info.avatar || null,
    });
  }

  getSpectator(socketId) {
    const s = this.spectators.get(socketId);
    if (!s) return null;
    // Lazy cleanup: the table may have been torn down while this watcher sat
    // there. Without this they stay "watching" a room that no longer exists,
    // and anything they say is relayed into a dead socket room.
    if (!this.rooms.has(s.roomCode)) {
      this.spectators.delete(socketId);
      return null;
    }
    return s;
  }

  /**
   * Drop everyone watching a table and hand back their socket ids so the
   * caller can tell them. Used when a game ends or a room is torn down —
   * a watcher left attached to a dead room shows as permanently "watching"
   * in presence and can never be cleaned up by anything else.
   */
  evictSpectators(roomCode) {
    const evicted = [];
    for (const [socketId, s] of this.spectators) {
      if (s.roomCode === roomCode) { evicted.push(socketId); this.spectators.delete(socketId); }
    }
    return evicted;
  }

  removeSpectator(socketId) {
    const s = this.spectators.get(socketId);
    this.spectators.delete(socketId);
    return s || null;
  }

  /** How many people are watching a table (for the overview badge). */
  spectatorCount(roomCode) {
    let n = 0;
    for (const s of this.spectators.values()) if (s.roomCode === roomCode) n += 1;
    return n;
  }

  // ── presence ──────────────────────────────────────────────────────────────
  //
  // Who is on the site right now. Separate from rooms: a player sitting in the
  // lobby belongs to no room, and that is exactly who this is for. Keyed by
  // socket, but collapsed by NAME on the way out — two tabs is one person, not
  // two, and showing them twice on the homepage rail would look broken.

  announcePresence(socketId, name) {
    const clean = String(name || '').trim();
    if (!clean) return;
    this.presence.set(socketId, {
      name: clean,
      since: this.presence.get(socketId)?.since || Date.now(),
    });
  }

  forgetPresence(socketId) { this.presence.delete(socketId); }

  /**
   * One entry per person, with what they're currently doing. Status is derived
   * live from the room/spectator registries rather than stored, so it can't go
   * stale when someone joins a table without telling the presence layer.
   */
  onlineView() {
    const byName = new Map();
    for (const [socketId, p] of this.presence) {
      const key = p.name.toLowerCase();

      let status = 'lobby';
      let roomCode = null;
      const watching = this.getSpectator(socketId);   // prunes dead rooms
      if (watching) {
        status = 'watching';
        roomCode = watching.roomCode;
      } else {
        const mapping = this.socketRoomMap.get(socketId);
        const room = mapping ? this.rooms.get(mapping.roomCode) : null;
        if (room) {
          roomCode = room.code;
          status = room.status === 'playing' ? 'playing' : 'waiting';
        }
      }

      // A person open in two tabs shows the more interesting state: at a
      // table beats idling in the lobby.
      const rank = { playing: 3, waiting: 2, watching: 1, lobby: 0 };
      const existing = byName.get(key);
      if (!existing || rank[status] > rank[existing.status]) {
        byName.set(key, { name: p.name, status, roomCode, since: p.since });
      }
    }
    return [...byName.values()].sort((a, b) => a.since - b.since);
  }

  /**
   * Live King tables a stranger could watch — only games actually in
   * progress; a waiting room has nothing to show.
   */
  watchableGames() {
    const out = [];
    for (const room of this.rooms.values()) {
      if (room.status !== 'playing' || !room.gameState) continue;
      // Nobody home. A room whose players have all dropped sits in memory
      // through its grace window (and can be rehydrated from live_games after
      // a restart), so without this the homepage advertises dead tables that
      // will never move again.
      if (!room.players.some((p) => p.connected)) continue;
      const gs = room.gameState;
      out.push({
        roomCode: room.code,
        mode: room.mode || 'public',
        tournament: room.tournamentId
          ? { stage: room.tournamentStage || null, table: room.tournamentTable ?? null }
          : null,
        round: gs.round,
        phase: gs.phase,
        startedAt: room.startedAt || null,
        watchers: this.spectatorCount(room.code),
        players: room.players.map((p) => ({
          name: p.name,
          avatar: p.avatar || null,
          seat: p.seat,
          connected: !!p.connected,
          score: gs.cumulativeScores?.[p.seat] ?? 0,
        })),
      });
    }
    return out.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  // ── persistence ───────────────────────────────────────────────────────────

  /**
   * Serialise a room to a plain JSON-friendly object that can be restored
   * later by `_roomFromSnapshot`. socket ids are preserved but considered
   * advisory — they're stale the moment the server restarts.
   */
  _roomSnapshot(room) {
    return {
      code: room.code,
      status: room.status,
      mode: room.mode || 'public',
      isPublic: !!room.isPublic,
      // Tournament tags travel with the snapshot so a restart mid-bracket
      // doesn't orphan the table from the tournament watching it.
      startedAt: room.startedAt || null,
      tournamentId: room.tournamentId || null,
      tournamentTable: room.tournamentTable ?? null,
      tournamentStage: room.tournamentStage || null,
      // Avatars are short /api/profiles/:id/avatar links, not photos.
      players: room.players.map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar || null,
        seat: p.seat, connected: !!p.connected,
        profileId: p.profileId || null, ownerKey: p.ownerKey || null,
      })),
      gameState: room.gameState ? room.gameState.serialize() : null,
    };
  }

  _roomFromSnapshot(snap) {
    if (!snap || !Array.isArray(snap.players)) return null;
    const room = {
      code: snap.code,
      status: snap.status || 'waiting',
      // Rows written before game modes existed have no `mode` — they were
      // all counted as championship games historically, but a *live* legacy
      // room is safest treated as public so it can't eat a quota slot.
      mode: snap.mode === 'championship' ? 'championship' : 'public',
      isPublic: !!snap.isPublic,
      startedAt: snap.startedAt || null,
      tournamentId: snap.tournamentId || null,
      tournamentTable: snap.tournamentTable ?? null,
      tournamentStage: snap.tournamentStage || null,
      players: snap.players.map((p) => ({
        id: p.id || null, name: p.name,
        // Snapshots written before photos became links carry a base64 photo.
        avatar: p.avatar && !String(p.avatar).startsWith('data:') ? p.avatar : null,
        seat: p.seat,
        profileId: p.profileId || null,
        ownerKey: p.ownerKey || null,
        // After a server restart no live socket exists, so everyone starts
        // disconnected until they re-join with the same room code + name.
        connected: false,
        leftAt: Date.now(),
      })),
      gameState: snap.gameState ? GameState.fromSnapshot(snap.gameState) : null,
      // Rematch coordination is transient and never persisted — if the
      // server restarts, players just press Play Again again.
      rematchRoomCode: null,
      rematchJoinedSeats: new Set(),
    };
    return room;
  }

  /**
   * Fire-and-forget snapshot to the database. Awaits internally but errors are only
   * logged — the in-memory state has already been updated and broadcast,
   * losing one snapshot is recoverable.
   */
  _persist(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.dbRetired) {
      // Room was deleted, or the game ended and `retireRoom` already dropped
      // the snapshot. Either way the live_games row must not come back — a
      // retired room stays in memory only long enough for "Play Again".
      store.deleteLiveGame(roomCode).catch((err) => {
        console.warn(`[GameManager] _persist delete ${roomCode} failed: ${err.message}`);
      });
      return;
    }
    const snapshot = this._roomSnapshot(room);
    store.saveLiveGame(roomCode, snapshot).catch((err) => {
      console.warn(`[GameManager] _persist save ${roomCode} failed: ${err.message}`);
    });
  }

  /**
   * Look the room up in memory; if it's not there, try the database. Designed to be
   * called from a join-room handler before falling back to "Room not found".
   */
  async tryLoadFromDB(roomCode) {
    if (this.rooms.has(roomCode)) return this.rooms.get(roomCode);
    let snap;
    try { snap = await store.loadLiveGame(roomCode); }
    catch (err) {
      console.warn(`[GameManager] tryLoadFromDB ${roomCode} failed: ${err.message}`);
      return null;
    }
    if (!snap) return null;
    if (snap.status === 'finished') {
      // Leftover row from before finished rooms were retired. Rehydrating it
      // would put the joiner straight onto a game-over screen — bin it.
      store.deleteLiveGame(roomCode).catch(() => {});
      return null;
    }
    const room = this._roomFromSnapshot(snap);
    if (!room) return null;
    this.rooms.set(roomCode, room);
    console.log(`[GameManager] Hydrated room ${roomCode} from DB (status=${room.status})`);
    return room;
  }

  /**
   * Called once at server boot. Reloads every persisted live room from the database
   * so a deploy/restart doesn't kill in-flight games.
   */
  async hydrateAll() {
    // Boot-time housekeeping: clear out finished/abandoned snapshots before
    // reading the table, so we never resurrect a dead room and the table
    // doesn't grow without bound.
    try {
      const purged = await store.purgeStaleLiveGames();
      if (purged > 0) console.log(`[GameManager] Purged ${purged} stale live_games row(s).`);
    } catch (err) {
      console.warn(`[GameManager] purgeStaleLiveGames failed: ${err.message}`);
    }
    let entries;
    try { entries = await store.listLiveGames(); }
    catch (err) {
      console.warn(`[GameManager] hydrateAll failed: ${err.message}`);
      return 0;
    }
    let loaded = 0;
    for (const { roomCode, snapshot } of entries) {
      if (this.rooms.has(roomCode)) continue;
      if (snapshot && snapshot.status === 'finished') continue;
      const room = this._roomFromSnapshot(snapshot);
      if (!room) continue;
      this.rooms.set(roomCode, room);
      loaded += 1;
    }
    if (loaded > 0) console.log(`[GameManager] Hydrated ${loaded} live room(s) from DB.`);
    return loaded;
  }

  // ── room lifecycle ────────────────────────────────────────────────────────

  _generateUniqueCode() {
    let code;
    do { code = generateCode(); } while (this.rooms.has(code));
    return code;
  }

  createRoom(socketId, identity, mode = 'public') {
    const roomCode = this._generateUniqueCode();
    this.rooms.set(roomCode, {
      code: roomCode,
      players: [seatRow(socketId, identity, 0)],
      gameState: null,
      status: 'waiting',
      // 'championship' games count toward the daily quota and feed the
      // score app's seasons; 'public' games are casual.
      mode: mode === 'championship' ? 'championship' : 'public',
      // Rematch coordination — populated when a finished room transitions
      // into "waiting for players to click Play Again". Lives only in
      // memory; never persisted.
      rematchRoomCode: null,
      rematchJoinedSeats: new Set(),
    });
    this.socketRoomMap.set(socketId, { roomCode, seat: 0 });
    this._persist(roomCode);
    return { roomCode, seat: 0 };
  }

  joinRoom(roomCode, socketId, identity) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error(`Room ${roomCode} not found.`);

    // Reconnection, in *every* phase including the `waiting` lobby: a tab
    // switch or wifi blip makes socket.io reconnect with a fresh id and the
    // client re-emits `join-room` (see GameContext). It ignores `connected`,
    // because the new socket's `connect` can be processed before the old
    // socket's `disconnect`. Only the seat's owner may take it back.
    const existingPlayer = findSeat(room.players, identity);

    if (existingPlayer) {
      if (!ownsSeat(existingPlayer, identity)) throw new Error('That name is already taken at this table.');
      // Cut the old socket's mapping loose so its eventual disconnect
      // event (which we may not even get) can't mutate this player's row.
      if (existingPlayer.id && existingPlayer.id !== socketId) {
        this.socketRoomMap.delete(existingPlayer.id);
      }
      existingPlayer.id = socketId;
      existingPlayer.connected = true;
      existingPlayer.leftAt = null;
      existingPlayer.ownerKey = existingPlayer.ownerKey || identity.ownerKey || null;
      if (identity.avatar) existingPlayer.avatar = identity.avatar;
      this.socketRoomMap.set(socketId, { roomCode, seat: existingPlayer.seat });
      // Someone is back — abort any pending "delete empty room" job.
      this.cancelRoomGrace(roomCode);
      console.log(`[GameManager] ${existingPlayer.name} reconnected to room ${roomCode} as seat ${existingPlayer.seat}`);
      this._persist(roomCode);
      return { seat: existingPlayer.seat, reconnected: true, status: room.status };
    }

    // No existing seat for this name — must be a genuinely new sit-down.
    if (room.status === 'playing' || room.status === 'finished') {
      throw new Error('Game has already started.');
    }

    if (room.players.length >= 3) throw new Error('Room is full.');

    // Lowest free seat — players can leave a waiting room (or be swept out
    // of the public lobby after a disconnect), leaving gaps that a plain
    // `players.length` would double-assign.
    const takenSeats = new Set(room.players.map((p) => p.seat));
    let seat = 0;
    while (takenSeats.has(seat)) seat++;
    room.players.push(seatRow(socketId, identity, seat));
    this.socketRoomMap.set(socketId, { roomCode, seat });
    console.log(`[GameManager] ${identity.name} joined room ${roomCode} as seat ${seat}`);
    this._persist(roomCode);
    return { seat, status: room.status };
  }

  /** Whether this identity already holds a seat in the room. */
  isSeated(room, identity) {
    return !!room && room.players.some((p) => ownsSeat(p, identity));
  }

  leaveRoom(socketId) {
    const mapping = this.socketRoomMap.get(socketId);
    if (!mapping) return null;
    const { roomCode } = mapping;
    const room = this.rooms.get(roomCode);
    if (!room) { this.socketRoomMap.delete(socketId); return null; }
    const playerIdx = room.players.findIndex((p) => p.id === socketId);
    if (playerIdx === -1) { this.socketRoomMap.delete(socketId); return null; }
    const { name: playerName } = room.players[playerIdx];
    // A running game still deals to and waits on this seat, so leaving it is
    // a disconnect: the seat stays and its owner can come back.
    if (room.status === 'playing') {
      const info = this.markDisconnected(socketId);
      return info && { ...info, room, stayed: true };
    }
    room.players.splice(playerIdx, 1);
    this.socketRoomMap.delete(socketId);
    if (room.players.length === 0) {
      this.rooms.delete(roomCode);
      console.log(`[GameManager] Room ${roomCode} deleted (empty).`);
      // _persist with no room → deletes the live_games row.
    }
    console.log(`[GameManager] ${playerName} left room ${roomCode}`);
    this._persist(roomCode);
    return { roomCode, playerName, room };
  }

  /**
   * Drop the room entirely (e.g. game ended, finished_games row already
   * stored, no reason to keep the live snapshot around).
   */
  destroyRoom(roomCode) {
    this.rooms.delete(roomCode);
    this.evictSpectators(roomCode);
    store.deleteLiveGame(roomCode).catch(() => {});
  }

  /**
   * The game is over (natural finish or surrender). The room has to stay in
   * memory for the rematch window, but its `live_games` row is finished
   * business: the result now lives in `finished_games`, and leaving the
   * snapshot behind is what used to strand rows in the table forever (and
   * let a returning player rehydrate into a dead game). Flag the room so no
   * later `_persist` writes it back, then drop the row.
   */
  retireRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    if (room) room.dbRetired = true;
    store.deleteLiveGame(roomCode).catch((err) => {
      console.warn(`[GameManager] retireRoom ${roomCode} failed: ${err.message}`);
    });
  }

  getRoom(roomCode) { return this.rooms.get(roomCode); }

  getMappingBySocketId(socketId) { return this.socketRoomMap.get(socketId); }

  startGame(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error(`Room ${roomCode} not found.`);
    if (room.players.length !== 3) throw new Error('Need exactly 3 players to start.');
    if (room.status !== 'waiting') throw new Error('Game already started.');
    const seatedPlayers = room.players.map((p) => ({ id: p.id, name: p.name, seat: p.seat }));
    room.gameState = new GameState(seatedPlayers);
    room.status = 'playing';
    // Wall-clock start, so the in-game timer is the same for all three
    // players and survives both a refresh and a server restart. Deriving it
    // client-side would give each player their own number, counting from
    // whenever they happened to load the page.
    room.startedAt = Date.now();
    console.log(`[GameManager] Game started in room ${roomCode}`);
    this._persist(roomCode);
    return room.gameState;
  }

  handleSelectGameType(roomCode, seat, typeCode) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return { ok: false, error: 'Game not found.' };
    const result = room.gameState.selectGameType(seat, typeCode);
    if (result.ok) this._persist(roomCode);
    return result;
  }

  handleDiscardCards(roomCode, seat, cards) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return { ok: false, error: 'Game not found.' };
    const result = room.gameState.discardCards(seat, cards);
    if (result.ok) this._persist(roomCode);
    return result;
  }

  handlePlayCard(roomCode, seat, card) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) {
      return {
        ok: false, error: 'Game not found.',
        trickComplete: false, trick: null, winnerSeat: null, roundEnds: false,
        scores: null, cumulativeScores: null, round: 0, isGameOver: false, gameType: null,
      };
    }
    const result = room.gameState.playCard(seat, card);
    if (result.ok) this._persist(roomCode);
    return result;
  }

  handleQuitRound(roomCode, quitterSeat) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return { ok: false, error: 'Game not found.' };
    const result = room.gameState.endRoundEarly(quitterSeat);
    if (result.ok) this._persist(roomCode);
    return result;
  }

  handleNextRound(roomCode, socketId) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found.');
    if (!room.gameState) throw new Error('Game not started.');
    const mapping = this.socketRoomMap.get(socketId);
    if (!mapping || mapping.seat !== this.roundStarterSeat(room)) {
      throw new Error('Only the room creator can advance the round.');
    }
    const result = room.gameState.startNextRound();
    if (!result.ok) throw new Error(result.error);
    this._persist(roomCode);
    return room.gameState;
  }

  /** Who starts the next round: seat 0, or the lowest connected seat while seat 0 is away. */
  roundStarterSeat(room) {
    const zero = room.players.find((p) => p.seat === 0);
    if (zero?.connected) return 0;
    const present = room.players.filter((p) => p.connected).map((p) => p.seat);
    return present.length ? Math.min(...present) : 0;
  }

  getStateForPlayer(roomCode, seat) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return null;
    return room.gameState.getStateForPlayer(seat);
  }

  markDisconnected(socketId) {
    const mapping = this.socketRoomMap.get(socketId);
    if (!mapping) return null;
    const room = this.rooms.get(mapping.roomCode);
    if (!room) return null;
    const player = room.players.find((p) => p.id === socketId);
    if (!player) return null;
    player.connected = false;
    player.leftAt = Date.now();
    // The socket id is dead; drop its mapping so it can't accidentally be
    // resolved later (and so the map doesn't slowly leak across long
    // sessions). The player's row in `room.players` keeps `seat`/`name`,
    // which is all we need to re-attach a future socket via `joinRoom`'s
    // reconnection branch.
    this.socketRoomMap.delete(socketId);
    console.log(`[GameManager] Player ${player.name} (seat ${player.seat}) disconnected from room ${mapping.roomCode}`);
    this._persist(mapping.roomCode);
    return { roomCode: mapping.roomCode, seat: player.seat, playerName: player.name };
  }

  // ── Grace timers ──────────────────────────────────────────────────────────
  // When every player in a room has disconnected, we used to delete the
  // room immediately. That meant a 1-second wifi blip affecting all 3
  // players (or a server hot-reload) tore the live game down and nobody
  // could rejoin without clicking through the lobby again. These helpers
  // arm/cancel a delayed delete so a quick reconnection just re-attaches
  // to the same in-memory room.

  /**
   * Schedule a delete of `roomCode` after ROOM_GRACE_MS *unless* someone
   * reconnects in the meantime. Idempotent — re-arming resets the clock.
   */
  armRoomGrace(roomCode) {
    this.cancelRoomGrace(roomCode);
    const t = setTimeout(() => {
      this.roomGraceTimers.delete(roomCode);
      const room = this.rooms.get(roomCode);
      if (!room) return; // already gone
      // Only delete if the room is still empty — someone may have reconnected
      // and we'd be racing with `cancelRoomGrace`.
      if (room.players.every((p) => !p.connected)) {
        console.log(`[GameManager] Room ${roomCode} grace expired — deleting in-memory copy.`);
        this.rooms.delete(roomCode);
        this.evictSpectators(roomCode);
        // A finished room was already retired, so there's no row left. An
        // unfinished one keeps its live_games row so a future join can
        // rehydrate it.
        if (room.dbRetired) store.deleteLiveGame(roomCode).catch(() => {});
      }
    }, ROOM_GRACE_MS);
    // Don't keep the Node event loop alive just for grace timers — if the
    // process is otherwise idle and ready to exit, the timer shouldn't
    // block shutdown.
    if (typeof t.unref === 'function') t.unref();
    this.roomGraceTimers.set(roomCode, t);
  }

  cancelRoomGrace(roomCode) {
    const t = this.roomGraceTimers.get(roomCode);
    if (!t) return;
    clearTimeout(t);
    this.roomGraceTimers.delete(roomCode);
  }

  // ── Quick-match rooms (homepage tables) ────────────────────────────────────
  //
  // The homepage shows two shared quick-match tables with 3 seats each — one
  // casual ("public" mode) and one championship. Sitting joins (or lazily
  // creates) the table's room; when the 3rd seat fills the game starts
  // automatically and the slot resets for the next trio. Reconnection reuses
  // the normal name-based joinRoom path, so a refreshed player can be
  // re-attached to their seat via `rejoin-public`.

  _normalizeQuickMatchMode(mode) {
    return mode === 'championship' ? 'championship' : 'public';
  }

  /** The waiting quick-match room for a mode, or null if none/stale. */
  quickMatchRoom(mode) {
    const key = this._normalizeQuickMatchMode(mode);
    const code = this.quickMatchCodes[key];
    const room = code ? this.rooms.get(code) : null;
    if (!room || room.status !== 'waiting') return null;
    return room;
  }

  /**
   * Seat a socket at a quick-match table. Creates the room on first sit.
   * Same-name sitters are re-attached to their existing seat (refresh-safe).
   */
  sitPublic(socketId, identity, emoji = null, mode = 'public') {
    const key = this._normalizeQuickMatchMode(mode);
    let code = this.quickMatchCodes[key];
    let room = code ? this.rooms.get(code) : null;
    if (!room || room.status !== 'waiting') {
      // Stale pointer (room started, died, or was GC'd) — start fresh.
      this.quickMatchCodes[key] = null;
      room = null;
      code = null;
    }

    let seat;
    if (!room) {
      const created = this.createRoom(socketId, identity, key);
      code = created.roomCode;
      seat = created.seat;
      room = this.rooms.get(code);
      room.isPublic = true;
      this.quickMatchCodes[key] = code;
    } else {
      const joined = this.joinRoom(code, socketId, identity);
      seat = joined.seat;
    }

    const player = room.players.find((p) => p.seat === seat);
    if (player && emoji !== undefined) player.emoji = emoji || player.emoji || null;
    return { roomCode: code, seat, mode: key };
  }

  _quickMatchTableView(mode) {
    const room = this.quickMatchRoom(mode);
    if (!room) return { roomCode: null, seats: [] };
    return {
      roomCode: room.code,
      seats: room.players.map((p) => ({
        seat: p.seat,
        name: p.name,
        avatar: p.avatar || null,
        emoji: p.emoji || null,
        connected: !!p.connected,
      })),
    };
  }

  /** Homepage view of both quick-match tables (empty when not collecting). */
  publicRoomView() {
    return {
      public: this._quickMatchTableView('public'),
      championship: this._quickMatchTableView('championship'),
    };
  }

  clearPublicRoom(roomCode) {
    for (const key of Object.keys(this.quickMatchCodes)) {
      if (this.quickMatchCodes[key] === roomCode) this.quickMatchCodes[key] = null;
    }
  }

  // ── Rematch flow ─────────────────────────────────────────────────────────
  //
  // After a game ends, the room sits in `status: 'finished'` for a short
  // grace window (see armRoomGrace on the handlers side). Any player on the
  // game-over screen can press "Play Again" — the first such click creates a
  // fresh room with that player as seat 0, every subsequent click from the
  // same finished room is forwarded into the same new room via joinRoom().
  // The old room learns who has signed up so the game-over UI on other
  // clients can render a "wants to play again" badge above each joined seat.
  //
  // Returns { newRoomCode, seat, joinedOldSeats: number[] } on success, or
  // { error: string } on validation failure.
  requestRematch(socketId, identity) {
    const mapping = this.socketRoomMap.get(socketId);
    if (!mapping) return { error: 'You are not in a room.' };
    const oldRoom = this.rooms.get(mapping.roomCode);
    if (!oldRoom) return { error: 'Room not found.' };
    if (oldRoom.status !== 'finished') return { error: 'Game is not finished yet.' };
    const oldSeat = mapping.seat;

    // Make sure the new-room slot is reserved before doing anything else —
    // if two players click "Play Again" at the same instant, only one of
    // them creates the room and the second one joins it.
    let newRoomCode = oldRoom.rematchRoomCode;
    let seat;

    if (!newRoomCode) {
      // First click: create a fresh room with this socket as seat 0. The
      // rematch inherits the finished game's mode (championship rematches
      // are quota-checked in the socket handler before we get here).
      const result = this.createRoom(socketId, identity, oldRoom.mode);
      newRoomCode = result.roomCode;
      seat = result.seat;
      oldRoom.rematchRoomCode = newRoomCode;
    } else {
      // Subsequent clicks: join the existing rematch room. joinRoom
      // handles "same name reconnecting" gracefully — including the
      // edge case where the clicker is already in the new room (which
      // happens if they double-tap Play Again).
      const newRoom = this.rooms.get(newRoomCode);
      if (!newRoom) {
        // The rematch room was destroyed between clicks (e.g. the
        // creator left and the room went empty). Clear the stale link
        // and treat this click as a brand-new first click.
        oldRoom.rematchRoomCode = null;
        return this.requestRematch(socketId, identity);
      }
      const joinResult = this.joinRoom(newRoomCode, socketId, identity);
      seat = joinResult.seat;
    }

    oldRoom.rematchJoinedSeats.add(oldSeat);
    // No need to _persist for old room — the rematch sub-state is in-memory only.
    return {
      newRoomCode,
      seat,
      joinedOldSeats: [...oldRoom.rematchJoinedSeats].sort((a, b) => a - b),
    };
  }
}

module.exports = GameManager;
module.exports.ownsSeat = ownsSeat;
