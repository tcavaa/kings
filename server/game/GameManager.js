'use strict';

const { EventEmitter } = require('events');
const GameState = require('./GameState');
const { generateCode, sameName, normalizeMode } = require('../lib/util');

// How long an entirely-empty (all players disconnected) room is kept alive
// in memory before being garbage-collected. The persisted `live_games` row
// also covers crash recovery, but holding the room in memory means a quick
// network blip (mobile wifi switching cells, server hot-reload, etc.) never
// drops the table state — the rejoining player just reattaches to the same
// in-memory room. The database snapshot is the long-term backup; the timer is
// the short-term one.
const ROOM_GRACE_MS = Number(process.env.ROOM_GRACE_MS) || 90 * 1000;   // env: tests only

// A finished room only serves the game-over screen and "Play Again", so it
// goes after this long whoever is still looking at it.
const FINISHED_ROOM_TTL_MS = 10 * 60 * 1000;

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

/**
 * Every King room in memory, who sits where, and the game actions on them.
 *
 * Events, for the socket layer (this class never talks to sockets):
 *   'socket-detached' { socketId, roomCode, room, playerName, removed, watchedRoomCode }
 *       a socket moved on to another room: it must leave the old room's
 *       channel, and the old room hears that the player left or went offline.
 *   'room-expired' { roomCode, watchers }
 *       a room was dropped from memory; `watchers` were still watching it.
 */
class GameManager extends EventEmitter {
  constructor() {
    super();
    this.rooms = new Map();
    this.socketRoomMap = new Map();
    // roomCode -> Timeout: pending "delete if still empty" job.
    this.roomGraceTimers = new Map();
    // roomCode -> Promise: database loads still running (see tryLoadFromDB).
    this.roomLoads = new Map();
    // The homepage quick-match rooms currently collecting players — one per
    // game mode. Cleared the moment a table's game starts (or the room dies)
    // so the next sitter opens a fresh table. In-memory only.
    this.quickMatchCodes = { public: null, championship: null };
    this.spectators = new Map();   // socketId -> { roomCode, tournamentId, name, avatar }
    // Everyone currently on the site, table or not. socketId -> { name, since }
    this.presence = new Map();
  }

  // ── room lifecycle ────────────────────────────────────────────────────────

  _generateUniqueCode() {
    let code;
    do { code = generateCode(); } while (this.rooms.has(code));
    return code;
  }

  /**
   * A socket is about to take a seat in `nextRoomCode`: let go of whatever it
   * held before. A seat in a room still collecting players is given up; in a
   * running or finished game the seat stays for its owner but shows offline,
   * so the room can be cleaned up once everyone has gone. Watching stops too.
   * Returns the room it left, or null.
   */
  detachSocket(socketId, nextRoomCode = null) {
    if (!socketId) return null;   // a bracket seat held for an offline entrant
    const watched = this.removeSpectator(socketId);
    const watchedRoomCode = watched && watched.roomCode !== nextRoomCode ? watched.roomCode : null;
    const mapping = this.socketRoomMap.get(socketId);
    if (!mapping || mapping.roomCode === nextRoomCode) {
      if (watchedRoomCode) this.emit('socket-detached', { socketId, roomCode: null, room: null, watchedRoomCode });
      return null;
    }
    const { roomCode } = mapping;
    this.socketRoomMap.delete(socketId);
    const room = this.rooms.get(roomCode);
    const player = room?.players.find((p) => p.id === socketId);
    let removed = false;
    if (player) {
      if (room.status === 'waiting') {
        room.players = room.players.filter((p) => p !== player);
        removed = true;
        if (!room.players.length) {
          this.rooms.delete(roomCode);
          this.clearPublicRoom(roomCode);
        }
      } else {
        player.connected = false;
        player.leftAt = Date.now();
      }
      if (this.rooms.has(roomCode) && room.players.every((p) => !p.connected)) this.armRoomGrace(roomCode);
      this._persist(roomCode);
    }
    this.emit('socket-detached', {
      socketId,
      roomCode,
      room: this.rooms.get(roomCode) || null,
      playerName: player?.name || null,
      removed,
      watchedRoomCode,
    });
    return roomCode;
  }

  createRoom(socketId, identity, mode = 'public') {
    const roomCode = this._generateUniqueCode();
    this.detachSocket(socketId, roomCode);
    this.rooms.set(roomCode, {
      code: roomCode,
      players: [seatRow(socketId, identity, 0)],
      gameState: null,
      status: 'waiting',
      // 'championship' games count toward the daily quota and feed the
      // score app's seasons; 'public' games are casual.
      mode: normalizeMode(mode),
      // Rematch coordination — populated when a finished room transitions
      // into "waiting for players to click Play Again". Lives only in
      // memory; never persisted.
      rematchRoomCode: null,
      rematchJoinedSeats: new Set(),
    });
    if (socketId) this.socketRoomMap.set(socketId, { roomCode, seat: 0 });
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
      this.detachSocket(socketId, roomCode);
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
      if (existingPlayer.sweepTimer) {
        clearTimeout(existingPlayer.sweepTimer);
        existingPlayer.sweepTimer = null;
      }
      this.socketRoomMap.set(socketId, { roomCode, seat: existingPlayer.seat });
      // Someone is back — abort any pending "delete empty room" job. A
      // finished room keeps its countdown: it only serves the results screen.
      if (room.status !== 'finished') this.cancelRoomGrace(roomCode);
      console.log(`[GameManager] ${existingPlayer.name} reconnected to room ${roomCode} as seat ${existingPlayer.seat}`);
      this._persist(roomCode);
      return { seat: existingPlayer.seat, reconnected: true, status: room.status };
    }

    // No existing seat for this name — must be a genuinely new sit-down.
    if (room.status === 'playing' || room.status === 'finished') {
      throw new Error('Game has already started.');
    }

    if (room.players.length >= 3) throw new Error('Room is full.');

    this.detachSocket(socketId, roomCode);
    // Lowest free seat — players can leave a waiting room (or be swept out
    // of the public lobby after a disconnect), leaving gaps that a plain
    // `players.length` would double-assign.
    const takenSeats = new Set(room.players.map((p) => p.seat));
    let seat = 0;
    while (takenSeats.has(seat)) seat++;
    room.players.push(seatRow(socketId, identity, seat));
    if (socketId) this.socketRoomMap.set(socketId, { roomCode, seat });
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
      this._dropRoom(roomCode);
      console.log(`[GameManager] Room ${roomCode} deleted (empty).`);
    }
    console.log(`[GameManager] ${playerName} left room ${roomCode}`);
    this._persist(roomCode);
    return { roomCode, playerName, room };
  }

  /**
   * Take a room out of memory: its socket mappings, grace timer, homepage
   * pointer and watchers go with it. Returns the watchers' socket ids.
   */
  _dropRoom(roomCode) {
    this.rooms.delete(roomCode);
    this.cancelRoomGrace(roomCode);
    this.clearPublicRoom(roomCode);
    for (const [socketId, m] of this.socketRoomMap) {
      if (m.roomCode === roomCode) this.socketRoomMap.delete(socketId);
    }
    return this.evictSpectators(roomCode);
  }

  /**
   * Drop the room entirely and its live_games row with it (a homepage table
   * whose last sitter was swept out).
   */
  destroyRoom(roomCode) {
    const watchers = this._dropRoom(roomCode);
    this._persist(roomCode);   // no room any more → deletes the row
    return watchers;
  }

  getRoom(roomCode) { return this.rooms.get(roomCode); }

  getMappingBySocketId(socketId) { return this.socketRoomMap.get(socketId); }

  startGame(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error(`Room ${roomCode} not found.`);
    if (room.players.length !== 3) throw new Error('Need exactly 3 players to start.');
    if (room.status !== 'waiting') throw new Error('Game already started.');
    room.gameState = new GameState();
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

  // ── game actions ──────────────────────────────────────────────────────────
  // Each runs one GameState move and saves the room when it went through.

  _mutateGame(roomCode, fn) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.gameState) return { ok: false, error: 'Game not found.' };
    const result = fn(room.gameState);
    if (result.ok) this._persist(roomCode);
    return result;
  }

  handleSelectGameType(roomCode, seat, typeCode) {
    return this._mutateGame(roomCode, (gs) => gs.selectGameType(seat, typeCode));
  }

  handleSelectTrump(roomCode, seat, suit) {
    return this._mutateGame(roomCode, (gs) => gs.selectTrump(seat, suit));
  }

  handleDiscardCards(roomCode, seat, cards) {
    return this._mutateGame(roomCode, (gs) => gs.discardCards(seat, cards));
  }

  handlePlayCard(roomCode, seat, card) {
    return this._mutateGame(roomCode, (gs) => gs.playCard(seat, card));
  }

  handleQuitRound(roomCode, quitterSeat) {
    return this._mutateGame(roomCode, (gs) => gs.endRoundEarly(quitterSeat));
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

  /**
   * League games this name is in the middle of, or has finished but whose
   * save hasn't landed yet: the database quota can't see either, so a second
   * tab or a quick Play Again would otherwise get past the daily limit.
   * Bracket tables never count.
   */
  championshipGamesInFlight(name) {
    let n = 0;
    for (const room of this.rooms.values()) {
      if (room.mode !== 'championship' || room.tournamentId) continue;
      const counts = room.status === 'playing' || (room.status === 'finished' && !room.saved);
      if (counts && room.players.some((p) => sameName(p.name, name))) n += 1;
    }
    return n;
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
    return { roomCode: mapping.roomCode, seat: player.seat, playerName: player.name, player };
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
   * reconnects in the meantime. A finished room goes after
   * FINISHED_ROOM_TTL_MS whoever is still around. Idempotent — re-arming
   * resets the clock.
   */
  armRoomGrace(roomCode) {
    this.cancelRoomGrace(roomCode);
    const finished = this.rooms.get(roomCode)?.status === 'finished';
    const t = setTimeout(() => {
      this.roomGraceTimers.delete(roomCode);
      const room = this.rooms.get(roomCode);
      if (!room) return; // already gone
      // Only delete if the room is still empty — someone may have reconnected
      // and we'd be racing with `cancelRoomGrace`.
      if (room.status === 'finished' || room.players.every((p) => !p.connected)) {
        console.log(`[GameManager] Room ${roomCode} grace expired — deleting in-memory copy.`);
        const watchers = this._dropRoom(roomCode);
        // A finished room was already retired, so there's no row left. An
        // unfinished one keeps its live_games row so a future join can
        // rehydrate it.
        if (room.dbRetired) this._persist(roomCode);
        this.emit('room-expired', { roomCode, watchers });
      }
    }, finished ? FINISHED_ROOM_TTL_MS : ROOM_GRACE_MS);
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

  /** The waiting quick-match room for a mode, or null if none/stale. */
  quickMatchRoom(mode) {
    const code = this.quickMatchCodes[normalizeMode(mode)];
    const room = code ? this.rooms.get(code) : null;
    if (!room || room.status !== 'waiting') return null;
    return room;
  }

  /**
   * Seat a socket at a quick-match table. Creates the room on first sit.
   * Same-name sitters are re-attached to their existing seat (refresh-safe).
   */
  sitPublic(socketId, identity, emoji = null, mode = 'public') {
    const key = normalizeMode(mode);
    let room = this.quickMatchRoom(key);
    // A stale pointer (room started, died, or was GC'd) starts a fresh table.
    if (!room) this.quickMatchCodes[key] = null;

    let seat;
    if (!room) {
      const created = this.createRoom(socketId, identity, key);
      seat = created.seat;
      room = this.rooms.get(created.roomCode);
      room.isPublic = true;
      this.quickMatchCodes[key] = room.code;
    } else {
      seat = this.joinRoom(room.code, socketId, identity).seat;
    }

    const player = room.players.find((p) => p.seat === seat);
    if (player && emoji !== undefined) player.emoji = emoji || player.emoji || null;
    return { roomCode: room.code, seat, mode: key };
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
  // After a game ends, the room sits in `status: 'finished'` for a while (see
  // armRoomGrace). Any player on the game-over screen can press "Play Again" —
  // the first such click creates a fresh room with that player as seat 0,
  // every subsequent click from the same finished room is forwarded into the
  // same new room via joinRoom(). The old room learns who has signed up so
  // the game-over UI on other clients can render a "wants to play again"
  // badge above each joined seat.
  //
  // Returns { newRoomCode, seat, joinedOldSeats: number[], repeat? } on
  // success, or { error: string } on validation failure.
  requestRematch(socketId, identity) {
    const mapping = this.socketRoomMap.get(socketId);
    if (!mapping) return { error: 'You are not in a room.' };
    const current = this.rooms.get(mapping.roomCode);
    if (!current) return { error: 'Room not found.' };

    // A second tap after the first one already moved this socket into the
    // rematch room: answer it the same way again.
    if (current.status === 'waiting' && current.rematchOf) {
      const oldRoom = this.rooms.get(current.rematchOf);
      return {
        newRoomCode: current.code,
        seat: mapping.seat,
        joinedOldSeats: oldRoom ? [...oldRoom.rematchJoinedSeats].sort((a, b) => a - b) : [],
        oldRoomCode: current.rematchOf,
        repeat: true,
      };
    }

    const oldRoom = current;
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
      this.rooms.get(newRoomCode).rematchOf = oldRoom.code;
    } else {
      // Subsequent clicks: join the existing rematch room.
      const newRoom = this.rooms.get(newRoomCode);
      if (!newRoom) {
        // The rematch room was destroyed between clicks (e.g. the
        // creator left and the room went empty). Clear the stale link
        // and treat this click as a brand-new first click.
        oldRoom.rematchRoomCode = null;
        return this.requestRematch(socketId, identity);
      }
      seat = this.joinRoom(newRoomCode, socketId, identity).seat;
    }

    oldRoom.rematchJoinedSeats.add(oldSeat);
    // No need to _persist for old room — the rematch sub-state is in-memory only.
    return {
      newRoomCode,
      seat,
      joinedOldSeats: [...oldRoom.rematchJoinedSeats].sort((a, b) => a - b),
      oldRoomCode: oldRoom.code,
    };
  }
}

Object.assign(GameManager.prototype, require('./presence'), require('./roomPersistence'));

module.exports = GameManager;
module.exports.ownsSeat = ownsSeat;
