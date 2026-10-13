'use strict';

const { seedTables, pickFinalists, VALID_SIZES, FINAL_SEATS } = require('./bracket');
const { ownsSeat } = require('../game/GameManager');

// How long a finished tournament stays around for its results screen.
const DONE_TTL_MS = 10 * 60 * 1000;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

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
    entry.id = socketId;
    entry.connected = true;
    if (identity.avatar) entry.avatar = identity.avatar;
    return t;
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
      standings: [],
      winners: [],
    };
    this.tournaments.set(tournament.id, tournament);
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
      seated.id = socketId;
      seated.connected = true;
      if (identity.avatar) seated.avatar = identity.avatar;
      return { tournament: t, rejoined: true };
    }

    if (t.status !== 'lobby') throw new Error('That tournament has already started.');
    if (t.players.length >= t.size) throw new Error('Tournament is full.');
    if (this.findBySocket(socketId) || this.findByIdentity(identity)) {
      throw new Error('You are already in a tournament.');
    }

    t.players.push(entryFor(socketId, identity));
    console.log(`[Tournament] ${name} joined ${t.code} (${t.players.length}/${t.size})`);
    return { tournament: t, rejoined: false };
  }

  /** Leave before the draw. Once seeded, seats are fixed. */
  leave(socketId) {
    const t = this.findBySocket(socketId);
    if (!t || t.status !== 'lobby') return null;
    const idx = t.players.findIndex((p) => p.id === socketId);
    if (idx === -1) return null;
    const [gone] = t.players.splice(idx, 1);
    console.log(`[Tournament] ${gone.name} left ${t.code}`);
    // An empty lobby is dead weight — drop it so the list stays honest.
    if (t.players.length === 0) {
      this.tournaments.delete(t.id);
      return { tournament: null, code: t.code };
    }
    return { tournament: t, code: t.code };
  }

  markDisconnected(socketId) {
    const t = this.findBySocket(socketId);
    if (!t) return null;
    const p = t.players.find((x) => x.id === socketId);
    if (p) p.connected = false;
    // Deliberately no forfeit: a tournament waits indefinitely for its
    // players, so a dropout only shows as "offline" in the roster.
    return t;
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

    const groups = seedTables(t.players);
    t.tables = groups.map((group, index) => {
      const roomCode = this._openTable(t, group, index, 'semifinal');
      return {
        index,
        roomCode,
        status: 'playing',
        players: group.map((p) => ({ name: p.name, avatar: p.avatar || null })),
        result: null,
      };
    });
    t.status = 'semifinal';
    console.log(`[Tournament] ${t.code} semifinal: ${t.tables.length} tables`);
    return t;
  }

  /**
   * Create a King room for `group`, seat everyone, tag it, and start it.
   * Returns the room code.
   */
  _openTable(t, group, index, stage) {
    const [host, ...rest] = group;
    // Tournament games are championship-grade for the leaderboard, but entry
    // is never gated on the daily quota — that check is skipped upstream for
    // tournament rooms.
    const { roomCode } = this.gameManager.createRoom(host.id, host, 'championship');
    for (const p of rest) this.gameManager.joinRoom(roomCode, p.id, p);

    const room = this.gameManager.getRoom(roomCode);
    room.tournamentId = t.id;
    room.tournamentTable = index;
    room.tournamentStage = stage;

    // Deal before broadcasting: the socket layer needs a live gameState to
    // push hands from, and starting here keeps a broadcaster-less run (tests)
    // producing a real, playable table.
    const gameState = this.gameManager.startGame(roomCode);
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

    if (t.finalRoomCode === roomCode) {
      t.status = 'done';
      t.winners = payload.winners || [];
      console.log(`[Tournament] ${t.code} won by ${t.winners.map((w) => w.name).join(', ')}`);
      if (this.broadcast) this.broadcast.tournamentComplete(t);
      this._forgetLater(t);
      return 'complete';
    }

    const table = t.tables.find((tb) => tb.roomCode === roomCode);
    if (!table || table.status === 'finished') return 'ignored';

    table.status = 'finished';
    table.result = {
      tableIndex: table.index,
      winners: payload.winners || [],
      finalScores: payload.finalScores || {},
      players: payload.players || [],
      roundDetails: payload.roundDetails || [],
    };
    console.log(`[Tournament] ${t.code} table ${table.index} finished`);

    if (this.broadcast) this.broadcast.overviewChanged(t);
    if (!t.tables.every((tb) => tb.status === 'finished')) return 'recorded';

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

    t.finalRoomCode = this._openTable(t, group, 0, 'final');
    t.status = 'final';
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
   * Reads straight from the live GameState so it's never stale.
   */
  overview(t) {
    if (!t) return null;
    const tableView = (roomCode, index, label, recorded) => {
      const room = this.gameManager.getRoom(roomCode);
      const gs = room?.gameState;
      return {
        index,
        label,
        roomCode,
        status: recorded?.status || (room ? room.status : 'unknown'),
        round: gs?.round ?? null,
        phase: gs?.phase ?? null,
        currentTurn: gs?.currentTurn ?? null,
        players: (room?.players || recorded?.players || []).map((p) => ({
          name: p.name,
          avatar: p.avatar || null,
          seat: p.seat ?? null,
          connected: p.connected !== false,
          score: gs ? (gs.cumulativeScores?.[p.seat] ?? 0)
                    : (recorded?.result?.finalScores?.[p.seat] ?? 0),
        })),
        winners: recorded?.result?.winners || [],
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
        ? tableView(t.finalRoomCode, 0, 'ფინალი', null)
        : null,
      standings: t.standings,
      winners: t.winners,
    };
  }

}

module.exports = TournamentManager;
