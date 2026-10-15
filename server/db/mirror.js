'use strict';

// ─── table mirrors ───────────────────────────────────────────────────────────
// `finished_games` rows from before photos became links embed every player's
// base64 avatar (~60 KB a row) and `profiles` carries the photos too. The
// MySQL build re-read them on every request, which cost nothing against a
// MySQL on the same box but would burn through Supabase's egress allowance
// over the network. So each process keeps a copy, and before EVERY read asks
// Postgres for (id, xmin) pairs only: new ids are fetched, vanished ids
// dropped, and a changed xmin (the row was rewritten) re-fetched. Readers
// therefore always see exactly what a fresh SELECT would return — the bulky
// columns just cross the wire once.

const CHUNK = 50;          // rows per fetch, so a cold start never asks for the whole table
const CONCURRENCY = 3;     // chunks in flight at once
// Every reader waits on the sync, so one stuck query would hold every request
// on the instance until the platform kills it (300 s on Vercel). Past this,
// the sync fails, its readers get an error, and the next read starts afresh.
const SYNC_TIMEOUT_MS = 20000;

function withTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Database sync timed out — try again')), SYNC_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function createMirror({ fetchMarks, fetchRows, makeEntry }) {
  const entries = new Map();   // id -> entry (entry.v = xmin of the row we hold)
  let running = null;          // the sync currently talking to the database
  let queued = null;           // one follow-up sync shared by mid-run arrivals

  async function pull() {
    const marks = await fetchMarks();
    const live = new Set();
    const want = [];
    for (const { id, v } of marks) {
      live.add(id);
      const have = entries.get(id);
      if (!have || have.v !== v) want.push(id);
    }
    for (const id of [...entries.keys()]) if (!live.has(id)) entries.delete(id);
    const chunks = [];
    for (let i = 0; i < want.length; i += CHUNK) chunks.push(want.slice(i, i + CHUNK));
    const worker = async () => {
      for (let ids = chunks.shift(); ids; ids = chunks.shift()) {
        const rows = await fetchRows(ids);
        for (const row of await makeEntry(rows)) entries.set(row.id, row);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
  }

  function start() {
    running = withTimeout(pull()).finally(() => { running = null; });
    return running;
  }

  /** Resolves once the mirror reflects every row committed before the call. */
  function sync() {
    if (queued) return queued;
    if (running) {
      // A sync already in flight may have read its marks before our caller's
      // data landed, so run one more after it — shared by everyone waiting.
      queued = running.catch(() => {}).then(() => { queued = null; return start(); });
      return queued;
    }
    return start();
  }

  return { entries, sync };
}

/** A Date (or timestamp string) as an ISO string; anything else unchanged. */
const iso = (v) => (v instanceof Date ? v.toISOString() : v);

module.exports = { createMirror, iso };
