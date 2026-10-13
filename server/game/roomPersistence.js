'use strict';

// Saving rooms to `live_games` and bringing them back after a restart. Mixed
// into GameManager (see the bottom of GameManager.js).

const GameState = require('./GameState');
const store     = require('../db/store');
const { TOTAL_ROUNDS } = require('./constants');

// Retries for dropping a finished game's snapshot. If every one fails, the
// next boot still skips the row (see _isOver).
const RETIRE_RETRY_MS = [2000, 10000, 30000];

/** A snapshot of a game that has already been played out. */
function _isOver(snap) {
  const phase = snap?.gameState?.phase;
  return snap?.status === 'finished' || phase === 'game_over'
    || (phase === 'round_end' && (snap.gameState.round || 0) >= TOTAL_ROUNDS);
}

const persistenceMethods = {
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
  },

  _roomFromSnapshot(snap) {
    if (!snap || !Array.isArray(snap.players)) return null;
    return {
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
  },

  /**
   * Whether a stored snapshot is worth bringing back. Finished games (their
   * result is in finished_games) and homepage quick-match tables that were
   * still collecting players (nobody can find them again: the homepage
   * pointer to them lives in memory only) are dropped from the table.
   */
  _restorable(roomCode, snap) {
    if (!snap) return false;
    if (_isOver(snap) || (snap.isPublic && snap.status === 'waiting')) {
      store.deleteLiveGame(roomCode).catch(() => {});
      return false;
    }
    return true;
  },

  /** Put a restored room in memory; it lives on only if someone comes back. */
  _adoptRestored(roomCode, room) {
    this.rooms.set(roomCode, room);
    // Everyone in a restored room starts offline, so this is the same
    // "delete if nobody reconnects" window a room gets when all drop at once.
    this.armRoomGrace(roomCode);
  },

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
  },

  /**
   * Look the room up in memory; if it's not there, try the database. Designed to be
   * called from a join-room handler before falling back to "Room not found".
   *
   * After a deploy all three players rejoin within a second of each other.
   * Concurrent calls for one room share a single load, and a room that turned
   * up in memory while the database answered wins — otherwise a second copy
   * would replace the one the first player had already joined.
   */
  tryLoadFromDB(roomCode) {
    if (this.rooms.has(roomCode)) return Promise.resolve(this.rooms.get(roomCode));
    const pending = this.roomLoads.get(roomCode);
    if (pending) return pending;
    const load = (async () => {
      let snap;
      try { snap = await store.loadLiveGame(roomCode); }
      catch (err) {
        console.warn(`[GameManager] tryLoadFromDB ${roomCode} failed: ${err.message}`);
        return null;
      }
      if (this.rooms.has(roomCode)) return this.rooms.get(roomCode);
      // A finished game would put the joiner straight onto a game-over screen.
      if (!this._restorable(roomCode, snap)) return null;
      const room = this._roomFromSnapshot(snap);
      if (!room) return null;
      this._adoptRestored(roomCode, room);
      console.log(`[GameManager] Hydrated room ${roomCode} from DB (status=${room.status})`);
      return room;
    })().finally(() => this.roomLoads.delete(roomCode));
    this.roomLoads.set(roomCode, load);
    return load;
  },

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
      if (!this._restorable(roomCode, snapshot)) continue;
      const room = this._roomFromSnapshot(snapshot);
      if (!room) continue;
      this._adoptRestored(roomCode, room);
      loaded += 1;
    }
    if (loaded > 0) console.log(`[GameManager] Hydrated ${loaded} live room(s) from DB.`);
    return loaded;
  },

  /**
   * The game is over (natural finish or surrender). The room has to stay in
   * memory for the rematch window, but its `live_games` row is finished
   * business: the result now lives in `finished_games`, and leaving the
   * snapshot behind is what used to strand rows in the table forever (and
   * let a returning player rehydrate into a dead game). Flag the room so no
   * later `_persist` writes it back, then drop the row.
   */
  retireRoom(roomCode, attempt = 0) {
    const room = this.rooms.get(roomCode);
    if (room) room.dbRetired = true;
    store.deleteLiveGame(roomCode).catch((err) => {
      if (attempt >= RETIRE_RETRY_MS.length) {
        console.warn(`[GameManager] retireRoom ${roomCode} failed for good: ${err.message}`);
        return;
      }
      const t = setTimeout(() => this.retireRoom(roomCode, attempt + 1), RETIRE_RETRY_MS[attempt]);
      if (typeof t.unref === 'function') t.unref();
    });
  },
};

module.exports = persistenceMethods;
