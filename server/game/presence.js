'use strict';

// Who is watching which table, and who is on the site at all. Mixed into
// GameManager (see the bottom of GameManager.js); neither touches the game
// itself.

const presenceMethods = {
  // ── spectators ────────────────────────────────────────────────────────────
  // Watchers, not players. Kept out of `rooms[].players` so nothing in the
  // game engine can ever deal to them or count them toward a seat, but
  // tracked here so the chat/voice handlers can still identify them — those
  // all resolve a sender via socketRoomMap, which a spectator is deliberately
  // absent from.

  addSpectator(socketId, roomCode, info = {}) {
    this.spectators.set(socketId, {
      roomCode,
      tournamentId: info.tournamentId || null,
      name: info.name || 'Spectator',
      avatar: info.avatar || null,
    });
  },

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
  },

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
  },

  removeSpectator(socketId) {
    const s = this.spectators.get(socketId);
    this.spectators.delete(socketId);
    return s || null;
  },

  /** How many people are watching a table (for the lobby's live list). */
  spectatorCount(roomCode) {
    let n = 0;
    for (const s of this.spectators.values()) if (s.roomCode === roomCode) n += 1;
    return n;
  },

  // ── presence ──────────────────────────────────────────────────────────────
  //
  // Who is on the site right now. Separate from rooms: a player sitting in the
  // lobby belongs to no room, and that is exactly who this is for. Keyed by
  // socket, but collapsed by NAME on the way out — two tabs is one person, not
  // two, and showing them twice on the homepage rail would look broken.

  /** Returns true when this changed what the lobby shows. */
  announcePresence(socketId, name) {
    const clean = String(name || '').trim();
    if (!clean) return false;
    const before = this.presence.get(socketId);
    this.presence.set(socketId, { name: clean, since: before?.since || Date.now() });
    return before?.name !== clean;
  },

  /** Returns true when the socket had announced itself. */
  forgetPresence(socketId) { return this.presence.delete(socketId); },

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
  },

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
          ? {
            id: room.tournamentId,
            code: String(room.tournamentId).replace(/^t_/, ''),
            stage: room.tournamentStage || null,
            table: room.tournamentTable ?? null,
          }
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
  },
};

module.exports = presenceMethods;
