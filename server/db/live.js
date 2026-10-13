'use strict';

// Rooms and tournaments in progress, saved so a game-server restart picks
// them up where they were (see GameManager's roomPersistence and
// TournamentManager.hydrateAll).

const { db } = require('./connection');

// Snapshots are written fire-and-forget after every action. Against a remote
// database two writes for the same row could otherwise overtake each other on
// different pool connections — and a stale snapshot landing after the
// game-over delete would resurrect a finished room. So every operation on a
// row runs strictly in call order.
const queues = new Map(); // key -> tail of that row's operation chain

function inOrder(key, fn) {
  const prev = queues.get(key) || Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

/**
 * Wait for every queued write to land (or `timeoutMs` to pass) — what a
 * shutdown does before exiting. Resolves true when everything landed.
 */
async function flushLiveWrites(timeoutMs = 5000) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); });
  const drained = (async () => {
    while (queues.size) await Promise.all([...queues.values()]);
    return true;
  })();
  const done = await Promise.race([drained, timeout]);
  clearTimeout(timer);
  return done;
}

// ─── live games (mid-flight rooms persisted for crash/rejoin recovery) ───────

const roomKey = (roomCode) => `room:${roomCode}`;

async function saveLiveGame(roomCode, snapshot) {
  if (!roomCode || !snapshot) return;
  const stateJson = JSON.stringify(snapshot);
  await inOrder(roomKey(roomCode), () => db()`
    INSERT INTO live_games (room_code, state_json) VALUES (${roomCode}, ${stateJson})
    ON CONFLICT (room_code) DO UPDATE SET state_json = EXCLUDED.state_json`);
}

async function loadLiveGame(roomCode) {
  const rows = await inOrder(roomKey(roomCode), () => db()`
    SELECT state_json FROM live_games WHERE room_code = ${roomCode} LIMIT 1`);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].state_json); }
  catch { return null; }
}

async function deleteLiveGame(roomCode) {
  await inOrder(roomKey(roomCode), () => db()`DELETE FROM live_games WHERE room_code = ${roomCode}`);
}

/**
 * Housekeeping for rows that outlived their room. Two classes get swept:
 *   • games that already finished (a `finished_games` row took over, so the
 *     snapshot is dead weight — and rehydrating one would drop a returning
 *     player back onto a game-over screen);
 *   • anything untouched for `maxAgeHours` (a crash mid-game leaves a row
 *     nobody will ever rejoin).
 * Returns the number of rows removed.
 */
async function purgeStaleLiveGames(maxAgeHours = 24) {
  const rows = await db()`SELECT room_code, state_json, updated_at FROM live_games`;
  const cutoff = Date.now() - maxAgeHours * 3600 * 1000;
  const doomed = [];
  for (const r of rows) {
    if (new Date(r.updated_at).getTime() < cutoff) { doomed.push(r.room_code); continue; }
    let snap;
    try { snap = JSON.parse(r.state_json); } catch { doomed.push(r.room_code); continue; }
    if (snap && snap.status === 'finished') doomed.push(r.room_code);
  }
  if (!doomed.length) return 0;
  await db()`DELETE FROM live_games WHERE room_code = ANY(${doomed})`;
  return doomed.length;
}

async function listLiveGames() {
  const rows = await db()`
    SELECT room_code, state_json FROM live_games ORDER BY updated_at DESC`;
  const out = [];
  for (const r of rows) {
    try { out.push({ roomCode: r.room_code, snapshot: JSON.parse(r.state_json) }); }
    catch { /* ignore malformed row */ }
  }
  return out;
}

// ─── live tournaments ────────────────────────────────────────────────────────
// One row per tournament that hasn't finished: its lobby, draw, recorded
// table results and final. Rows idle for a day are dropped on boot.

const tournamentKey = (id) => `tournament:${id}`;

async function saveLiveTournament(id, snapshot) {
  const stateJson = JSON.stringify(snapshot);
  await inOrder(tournamentKey(id), () => db()`
    INSERT INTO live_tournaments (id, state_json) VALUES (${id}, ${stateJson})
    ON CONFLICT (id) DO UPDATE SET state_json = EXCLUDED.state_json`);
}

async function deleteLiveTournament(id) {
  await inOrder(tournamentKey(id), () => db()`DELETE FROM live_tournaments WHERE id = ${id}`);
}

async function listLiveTournaments() {
  await db()`DELETE FROM live_tournaments WHERE updated_at < now() - interval '24 hours'`;
  const rows = await db()`SELECT id, state_json FROM live_tournaments ORDER BY updated_at`;
  const out = [];
  for (const r of rows) {
    try { out.push(JSON.parse(r.state_json)); }
    catch { /* ignore malformed row */ }
  }
  return out;
}

module.exports = {
  saveLiveGame, loadLiveGame, deleteLiveGame, listLiveGames, purgeStaleLiveGames,
  saveLiveTournament, deleteLiveTournament, listLiveTournaments,
  flushLiveWrites,
};
