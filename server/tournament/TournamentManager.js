'use strict';

const { seedTables, pickFinalists, VALID_SIZES, FINAL_SEATS } = require('./bracket');
const { ownsSeat } = require('../game/GameManager');
const { generateCode, sameName } = require('../lib/util');
const store = require('../db/store');

// How long a finished tournament stays around for its results screen.
const DONE_TTL_MS = 10 * 60 * 1000;

// How long an entrant may be offline before a lobby that hasn't started gives
// their place away. A refresh or a wifi blip comes back well within it.
const LOBBY_DROP_MS = Number(process.env.TOURNAMENT_DROP_MS) || 60 * 1000;   // env: tests only

function entryFor(socketId, identity) {
  return {
    id: socketId,
    name: identity.name,
    avatar: identity.avatar || null,
    connected: true,
    profileId: identity.profileId || null,
    ownerKey: identity.ownerKey || null,
  };
}

/**
 * Runs King tournaments: a lobby that fills to exactly 6 or 9, a randomly
 * seeded semifinal round of 3-player tables, and a single 3-seat final.
 *
 * Deliberately owns no socket emitting. Everything that needs to reach a
 * client goes through the broadcaster injected by `attach()`, which keeps the
 * bracket logic runnable (and testable) without a server. The King rooms
 * themselves are ordinary GameManager rooms — a tournament only tags them and
 * watches for their game-over.
 *
 * Every tournament is also saved to `live_tournaments` as it changes, so a
 * restart picks the bracket up where it was (see hydrateAll).
 */
class TournamentManager {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this.tournaments = new Map();   // id -> tournament
    this.broadcast = null;
  }

  /**
   * Wire up the emitting side. Called once, from the socket layer, which owns
   * the helpers (`playersView`, `_emitHandDealt`) needed to start a table the
   * same way the normal start-game path does.
   */
  attach(broadcast) {
    this.broadcast = broadcast;
  }

  // ── persistence ───────────────────────────────────────────────────────────

  _snapshot(t) {
    return {
      id: t.id,
      code: t.code,
      size: t.size,
      status: t.status,
      createdBy: t.createdBy,
      players: t.players.map((p) => ({
        id: p.id, name: p.name, avatar: p.avatar || null,
        profileId: p.profileId || null, ownerKey: p.ownerKey || null,
      })),
      tables: t.tables,
      finalRoomCode: t.finalRoomCode,
      finalResult: t.finalResult || null,
      standings: t.standings,
      winners: t.winners,
    };
  }

  /** Save (or, once it's done, drop) a tournament. Errors are only logged. */
  _persist(t) {
    const job = t.status === 'done' || !this.tournaments.has(t.id)
      ? store.deleteLiveTournament(t.id)
      : store.saveLiveTournament(t.id, this._snapshot(t));
    job.catch((err) => console.warn(`[Tournament] saving ${t.code} failed: ${err.message}`));
  }

  /**
   * Called once at boot, after the rooms are back (gameManager.hydrateAll):
   * bring back every unfinished tournament. Entrants start offline and get
   * their entry back by rejoining, like a seat. Rooms still tagged with a
   * tournament that didn't come back finish as ordinary league games.
   */
  async hydrateAll() {
    let rows = [];
    try { rows = await store.listLiveTournaments(); }
    catch (err) { console.warn(`[Tournament] hydrateAll failed: ${err.message}`); }
    for (const snap of rows) {
      if (!snap || !snap.id || !Array.isArray(snap.players) || snap.status === 'done') {
        if (snap?.id) store.deleteLiveTournament(snap.id).catch(() => {});
        continue;
      }
      const t = {
        ...snap,
        tables: Array.isArray(snap.tables) ? snap.tables : [],
        standings: snap.standings || [],
        winners: snap.winners || [],
        players: snap.players.map((p) => ({ ...p, connected: false })),
      };
      this.tournaments.set(t.id, t);
      if (t.status === 'lobby') t.players.forEach((p) => this._armDrop(t, p));
    }
    let untagged = 0;
    for (const room of this.gameManager.rooms.values()) {
      if (room.tournamentId && !this.tournaments.has(room.tournamentId)) {
        room.tournamentId = null;
        room.tournamentStage = null;
        room.tournamentTable = null;
        this.gameManager._persist(room.code);
        untagged += 1;
      }
    }
    if (this.tournaments.size) console.log(`[Tournament] Restored ${this.tournaments.size} tournament(s).`);
    if (untagged) console.log(`[Tournament] ${untagged} room(s) lost their tournament and play on as league games.`);
    return this.tournaments.size;
  }

  /** Bring a tournament's tables back into memory if they expired there. */
  async loadRooms(t) {
    const codes = [t.finalRoomCode, ...t.tables.map((tb) => tb.roomCode)].filter(Boolean);
    await Promise.all(codes.map((code) => this.gameManager.tryLoadFromDB(code)));
  }

  // ── lookup ────────────────────────────────────────────────────────────────

  findByCode(code) {
    const wanted = String(code || '').toUpperCase();
    for (const t of this.tournaments.values()) if (t.code === wanted) return t;
    return null;
  }

  /** The unfinished tournament a socket is entered in. */
  findBySocket(socketId) {
    for (const t of this.tournaments.values()) {
      if (t.status !== 'done' && t.players.some((p) => p.id === socketId)) return t;
    }
    return null;
  }

  /** The unfinished tournament this identity holds an entry in. */
  findByIdentity(identity) {
    for (const t of this.tournaments.values()) {
      if (t.status !== 'done' && t.players.some((p) => ownsSeat(p, identity))) return t;
    }
    return null;
  }

  /**
   * A socket reconnected: point the identity's entry at the new socket id so
   * the bracket reaches it again (tables, the final, overview updates).
   * Returns the tournament, or null.
   */
  rebind(socketId, identity) {
    const t = this.findByIdentity(identity);
    if (!t) return null;
    const entry = t.players.find((p) => ownsSeat(p, identity));
    this._backOnline(entry, socketId, identity);
    return t;
  }

  _backOnline(entry, socketId, identity) {
    entry.id = socketId;
    entry.connected = true;
    if (identity.avatar) entry.avatar = identity.avatar;
    if (entry.dropTimer) { clearTimeout(entry.dropTimer); entry.dropTimer = null; }
  }

  /** The live King room this identity plays in (a semifinal table or the final). */
  liveRoomOf(t, identity) {
    const codes = [t.finalRoomCode, ...t.tables.map((tb) => tb.roomCode)].filter(Boolean);
    for (const code of codes) {
      const room = this.gameManager.getRoom(code);
      if (room && room.status === 'playing' && room.players.some((p) => ownsSeat(p, identity))) return code;
    }
    return null;
  }

  /** The tournament that owns a King room, whether a semifinal table or the final. */
  findByRoom(roomCode) {
    for (const t of this.tournaments.values()) {
      if (t.finalRoomCode === roomCode) return t;
      if (t.tables.some((tb) => tb.roomCode === roomCode)) return t;
    }
    return null;
  }

  /** Every tournament still worth showing in the lobby. */
  openTournaments() {
    return [...this.tournaments.values()].filter((t) => t.status === 'lobby');
  }

  /** The lobby's list of tournaments to join. */
  openLobbyViews() {
    return this.openTournaments().map((t) => this.lobbyView(t));
  }

  // ── lobby ─────────────────────────────────────────────────────────────────

  create(socketId, identity, size) {
    const n = Number(size);
    if (!VALID_SIZES.includes(n)) {
      throw new Error(`A tournament must be ${VALID_SIZES.join(' or ')} players.`);
    }
    const { name } = identity;

    // One tournament at a time per player — otherwise a single person could
    // hold seats in two brackets and stall both.
    if (this.findBySocket(socketId) || this.findByIdentity(identity)) {
      throw new Error('You are already in a tournament.');
    }

    let code;
    do { code = generateCode(); } while (this.findByCode(code));

    const tournament = {
      id: `t_${code}`,
      code,
      size: n,
      status: 'lobby',
      createdBy: name,
      players: [entryFor(socketId, identity)],
      tables: [],
      finalRoomCode: null,
      finalResult: null,
      standings: [],
      winners: [],
    };
    this.tournaments.set(tournament.id, tournament);
    this._persist(tournament);
    console.log(`[Tournament] ${name} opened ${code} for ${n} players`);
    return tournament;
  }

  /**
   * Enter a lobby, or re-attach to a seat already held under this name (so a
   * refresh doesn't cost the player their place).
   */
  join(code, socketId, identity) {
    const t = this.findByCode(code);
    if (!t || t.status === 'done') throw new Error('Tournament not found.');
    const { name } = identity;

    const seated = t.players.find((p) => identity.profileId && p.profileId === identity.profileId)
      || t.players.find((p) => sameName(p.name, name));
    if (seated) {
      if (!ownsSeat(seated, identity)) throw new Error('That name is already in this tournament.');
      this._backOnline(seated, socketId, identity);
      return { tournament: t, rejoined: true };
    }

    if (t.status !== 'lobby') throw new Error('That tournament has already started.');
    if (t.players.length >= t.size) throw new Error('Tournament is full.');
    if (this.findBySocket(socketId) || this.findByIdentity(identity)) {
      throw new Error('You are already in a tournament.');
    }

    t.players.push(entryFor(socketId, identity));
    this._persist(t);
    console.log(`[Tournament] ${name} joined ${t.code} (${t.players.length}/${t.size})`);
    return { tournament: t, rejoined: false };
  }

  /** Leave before the draw. Once seeded, seats are fixed. */
  leave(socketId) {
    const t = this.findBySocket(socketId);
    if (!t || t.status !== 'lobby') return null;
    const gone = t.players.find((p) => p.id === socketId);
    if (!gone) return null;
    return this._removeEntrant(t, gone);
  }

  /** Take an entrant out of a lobby; an empty lobby goes with them. */
  _removeEntrant(t, entry) {
    if (entry.dropTimer) clearTimeout(entry.dropTimer);
    t.players = t.players.filter((p) => p !== entry);
    console.log(`[Tournament] ${entry.name} left ${t.code}`);
    // A lobby nobody is in any more is dead weight — drop it so the list
    // stays honest.
    if (!t.players.some((p) => p.connected)) {
      for (const p of t.players) if (p.dropTimer) clearTimeout(p.dropTimer);
      this.tournaments.delete(t.id);
      this._persist(t);
      return { tournament: null, code: t.code, id: t.id };
    }
    this._persist(t);
    return { tournament: t, code: t.code, id: t.id };
  }

  /**
   * Once seeded, a tournament waits indefinitely for its players: a dropout
   * only shows as "offline". In a lobby, an entrant who stays away gives their
   * place up after LOBBY_DROP_MS, so a lobby whose creator closed the tab
   * doesn't sit in everyone's list for ever.
   */
  markDisconnected(socketId) {
    const t = this.findBySocket(socketId);
    if (!t) return null;
    const p = t.players.find((x) => x.id === socketId);
    if (!p) return t;
    p.connected = false;
    if (t.status === 'lobby') this._armDrop(t, p);
    return t;
  }

  _armDrop(t, entry) {
    if (entry.dropTimer) clearTimeout(entry.dropTimer);
    entry.dropTimer = setTimeout(() => {
      entry.dropTimer = null;
      if (entry.connected || t.status !== 'lobby' || !t.players.includes(entry)) return;
      const res = this._removeEntrant(t, entry);
      if (this.broadcast) this.broadcast.lobbyChanged(res);
    }, LOBBY_DROP_MS);
    if (typeof entry.dropTimer.unref === 'function') entry.dropTimer.unref();
  }

  isFull(t) { return t.status === 'lobby' && t.players.length >= t.size; }

  // ── running the bracket ───────────────────────────────────────────────────

  /**
   * Draw the semifinal tables and start them. Each table is a normal
   * championship King room, tagged so its game-over reports back here.
   */
  startSemifinal(t) {
    if (t.status !== 'lobby') throw new Error('Tournament already started.');
    if (t.players.length !== t.size) throw new Error('Tournament is not full yet.');

    for (const p of t.players) {
      if (p.dropTimer) { clearTimeout(p.dropTimer); p.dropTimer = null; }
    }
    const groups = seedTables(t.players);
    // Status first: the tables are announced while they open, and anything
    // that asks on the way must already see a running bracket.
    t.status = 'semifinal';
    t.tables = groups.map((group, index) => ({
      index,
      roomCode: null,
      status: 'playing',
      players: group.map((p) => ({ name: p.name, avatar: p.avatar || null })),
      result: null,
    }));
    groups.forEach((group, index) => {
      t.tables[index].roomCode = this._openTable(t, group, index, 'semifinal');
    });
    this._persist(t);
    console.log(`[Tournament] ${t.code} semifinal: ${t.tables.length} tables`);
    return t;
  }

  /**
   * Create a King room for `group`, seat everyone, tag it, and start it.
   * Returns the room code.
   */
  _openTable(t, group, index, stage) {
    const gm = this.gameManager;
    const [host, ...rest] = group;
    // Tournament games are championship-grade for the leaderboard, but entry
    // is never gated on the daily quota — that check is skipped upstream for
    // tournament rooms, and their results don't count against it either.
    const { roomCode } = gm.createRoom(host.id, host, 'championship');
    for (const p of rest) gm.joinRoom(roomCode, p.id, p);

    const room = gm.getRoom(roomCode);
    room.tournamentId = t.id;
    room.tournamentTable = index;
    room.tournamentStage = stage;
    // An entrant who is offline right now is seated, but as offline: nobody
    // can deal to their dead socket, and they come back by rejoining.
    for (const row of room.players) {
      const entry = group.find((p) => sameName(p.name, row.name));
      if (entry && !entry.connected) {
        if (row.id) gm.socketRoomMap.delete(row.id);
        row.connected = false;
        row.leftAt = Date.now();
      }
    }

    // Deal before broadcasting: the socket layer needs a live gameState to
    // push hands from, and starting here keeps a broadcaster-less run (tests)
    // producing a real, playable table.
    const gameState = gm.startGame(roomCode);
    if (this.broadcast) {
      this.broadcast.startTable(t, roomCode, group, stage, index, gameState);
    }
    return roomCode;
  }

  /**
   * A tagged room finished. Record it; when the whole semifinal round is in,
   * work out the finalists and open the final.
   *
   * @returns {'ignored'|'recorded'|'final-started'|'complete'}
   */
  reportResult(roomCode, payload) {
    const t = this.findByRoom(roomCode);
    if (!t) return 'ignored';
    const result = {
      winners: payload.winners || [],
      finalScores: payload.finalScores || {},
      players: payload.players || [],
      roundDetails: payload.roundDetails || [],
    };

    if (t.finalRoomCode === roomCode) {
      t.status = 'done';
      t.winners = result.winners;
      t.finalResult = { ...result, roundDetails: [] };
      console.log(`[Tournament] ${t.code} won by ${t.winners.map((w) => w.name).join(', ')}`);
      this._persist(t);
      if (this.broadcast) this.broadcast.tournamentComplete(t);
      this._forgetLater(t);
      return 'complete';
    }

    const table = t.tables.find((tb) => tb.roomCode === roomCode);
    if (!table || table.status === 'finished') return 'ignored';

    table.status = 'finished';
    table.result = { tableIndex: table.index, ...result };
    console.log(`[Tournament] ${t.code} table ${table.index} finished`);

    if (!t.tables.every((tb) => tb.status === 'finished')) {
      this._persist(t);
      if (this.broadcast) this.broadcast.overviewChanged(t);
      return 'recorded';
    }

    if (this.broadcast) this.broadcast.overviewChanged(t);
    this._startFinal(t);
    return 'final-started';
  }

  /** All semifinals in — seat the three finalists. */
  _startFinal(t) {
    const { finalists, standings } = pickFinalists(t.tables.map((tb) => tb.result));
    t.standings = standings;

    if (finalists.length < FINAL_SEATS) {
      // Shouldn't happen (6 or 9 entrants always yield 3+ candidates), but
      // refusing loudly beats opening a broken final.
      console.warn(`[Tournament] ${t.code} could not fill the final (${finalists.length})`);
      t.status = 'done';
      this._persist(t);
      if (this.broadcast) this.broadcast.tournamentComplete(t);
      this._forgetLater(t);
      return;
    }

    // Map finalists back to their entries. The socket id comes from their
    // semifinal seat when that is newer: `join-room` keeps it current through
    // reconnects even if the client never re-sent `tournament-join`.
    const group = finalists.map((f) => {
      const entry = t.players.find((p) => sameName(p.name, f.name))
        || { id: null, name: f.name, avatar: f.avatar || null, connected: false };
      const seat = this._semifinalSeat(t, entry);
      if (seat?.connected && seat.id) { entry.id = seat.id; entry.connected = true; }
      return entry;
    });

    t.status = 'final';
    t.finalRoomCode = this._openTable(t, group, 0, 'final');
    this._persist(t);
    console.log(`[Tournament] ${t.code} final: ${group.map((g) => g.name).join(' vs ')}`);
    if (this.broadcast) this.broadcast.finalStarted(t, t.finalRoomCode, finalists);
  }

  _semifinalSeat(t, entry) {
    for (const tb of t.tables) {
      const seat = this.gameManager.getRoom(tb.roomCode)?.players.find((p) => sameName(p.name, entry.name));
      if (seat) return seat;
    }
    return null;
  }

  /** Keep a finished tournament for its results screen, then drop it. */
  _forgetLater(t) {
    const timer = setTimeout(() => this.tournaments.delete(t.id), DONE_TTL_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  // ── views ─────────────────────────────────────────────────────────────────

  /** Lobby card: enough to render "3/6 joined" and the roster. */
  lobbyView(t) {
    if (!t) return null;
    return {
      id: t.id,
      code: t.code,
      size: t.size,
      status: t.status,
      createdBy: t.createdBy,
      players: t.players.map((p) => ({
        name: p.name, avatar: p.avatar || null, connected: !!p.connected,
      })),
    };
  }

  /**
   * Live cross-table view: where every table is and what the scores are.
   * Reads straight from the live GameState while the room is in memory, and
   * from the recorded result once it has been freed.
   */
  overview(t) {
    if (!t) return null;
    const tableView = (roomCode, index, label, recorded) => {
      const room = this.gameManager.getRoom(roomCode);
      const gs = room?.gameState;
      const result = recorded?.result || null;
      return {
        index,
        label,
        roomCode,
        status: recorded?.status || (room ? room.status : 'unknown'),
        round: gs?.round ?? null,
        phase: gs?.phase ?? null,
        currentTurn: gs?.currentTurn ?? null,
        // The recorded roster has the seats the scores are keyed by; the
        // draw's list (recorded.players) is only names.
        players: (room?.players || result?.players || recorded?.players || []).map((p) => ({
          name: p.name,
          avatar: p.avatar || null,
          seat: p.seat ?? null,
          connected: p.connected !== false,
          score: gs ? (gs.cumulativeScores?.[p.seat] ?? 0)
                    : (result?.finalScores?.[p.seat] ?? 0),
        })),
        winners: result?.winners || [],
      };
    };

    return {
      id: t.id,
      code: t.code,
      size: t.size,
      status: t.status,
      stage: t.status,
      tables: t.tables.map((tb) =>
        tableView(tb.roomCode, tb.index, `მაგიდა ${tb.index + 1}`, tb)),
      final: t.finalRoomCode
        ? tableView(t.finalRoomCode, 0, 'ფინალი',
          t.finalResult ? { status: 'finished', result: t.finalResult } : null)
        : null,
      standings: t.standings,
      winners: t.winners,
    };
  }

}

module.exports = TournamentManager;
