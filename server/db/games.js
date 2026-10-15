'use strict';

// Finished games (King Online's and ჩაწერა's), lifetime stats and the daily
// championship quota.

const { db } = require('./connection');
const { createMirror, iso } = require('./mirror');
const { fromScoreSheet } = require('../games/scoreSheet');
const { winnerNames, emptyRoundStats, addRoundStats } = require('../games/results');
const { badRequest } = require('../lib/httpError');

// Every DATETIME the MySQL build wrote was wall-clock time on the cPanel box
// (Asia/Tbilisi), and the championship "calendar day" was that box's day.
// Postgres stores real instants, so the day boundary is computed in this zone.
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Tbilisi';

// How many championship games a player may finish per calendar day (server
// time). Enforced at room creation / join / quick-match sit; also exposed via
// the quota endpoint so the lobby can grey the championship options out.
const CHAMPIONSHIP_DAILY_LIMIT = 8;

function matchesMode(isChampionship, mode) {
  if (mode === 'championship') return isChampionship === 1;
  if (mode === 'public')       return isChampionship === 0;
  return true;
}

// finished_games.type: 'online' (played in King Online) or 'live' (played at
// a table and recorded in ჩაწერა). `type` filters: 'online' | 'live' | 'all'.
function matchesType(rowType, type) {
  return type === 'online' || type === 'live' ? rowType === type : true;
}

// The mirror holds each payload with its avatar data URLs swapped for a
// marker, plus the md5 of each swapped avatar in order of appearance. The
// distinct avatars live once in `avatarPool`, fetched only when a reader
// wants payloads with photos (and only the ones it needs). Re-inserting them
// in order rebuilds the stored text byte for byte. A raw U+0001 can never
// occur in JSON.stringify output (control characters are always escaped), so
// the marker cannot collide with real data.
const AVATAR_RE_SQL = '"avatar":"(data:[^"]*)"';
const AVATAR_SLOT_TEXT = '"avatar":"\u0001"';
const AVATAR_SLOT_RE = /"avatar":"\u0001"/g;
const avatarPool = new Map(); // md5 -> data URL

function parsePayload(text) {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch { return { ok: false, value: undefined }; }
}

function restorePayloadText(entry) {
  let i = 0;
  return entry.text.replace(AVATAR_SLOT_RE, () => {
    const data = avatarPool.get(entry.avatarHashes[i++]);
    return `"avatar":"${data}"`;
  });
}

const gameMirror = createMirror({
  fetchMarks: () => db()`SELECT id, xmin::text AS v FROM finished_games`,
  fetchRows: (ids) => db()`
    SELECT id, xmin::text AS v, type, played_at, winner_name, winner_seat, winner_score,
           is_championship,
           regexp_replace(payload, ${AVATAR_RE_SQL}, ${AVATAR_SLOT_TEXT}, 'g') AS text,
           ARRAY(
             SELECT md5(m.r[1])
               FROM regexp_matches(payload, ${AVATAR_RE_SQL}, 'g') WITH ORDINALITY AS m(r, n)
              ORDER BY m.n
           ) AS avatar_hashes
      FROM finished_games WHERE id = ANY(${ids})`,
  makeEntry: (rows) => rows.map((r) => ({
    id: r.id,
    v: r.v,
    type: r.type,
    played_at: r.played_at,
    winner_name: r.winner_name,
    winner_seat: r.winner_seat,
    winner_score: r.winner_score,
    is_championship: r.is_championship,
    text: r.text,
    avatarHashes: r.avatar_hashes,
    playedAtMs: new Date(r.played_at).getTime(),
    // Filled lazily, at most once per row version:
    fullParsed: undefined,  // payload parsed from its exact stored text
    bareParsed: undefined,  // payload parsed with every avatar nulled
    fullGame: undefined,    // rowToGame(fullParsed)
    bareGame: undefined,    // rowToGame(bareParsed)
  })),
});

/** Fetch the avatars these entries embed that the pool doesn't hold yet. */
async function loadAvatars(entries) {
  const missing = new Set();
  const ids = [];
  for (const e of entries) {
    const need = e.fullParsed === undefined ? e.avatarHashes.filter((h) => !avatarPool.has(h)) : [];
    if (!need.length) continue;
    ids.push(e.id);
    need.forEach((h) => missing.add(h));
  }
  if (!missing.size) return;
  const wanted = [...missing];
  const blobs = await db()`
    SELECT DISTINCT ON (h) h, d FROM (
      SELECT md5(m[1]) AS h, m[1] AS d
        FROM finished_games, regexp_matches(payload, ${AVATAR_RE_SQL}, 'g') AS m
       WHERE id = ANY(${ids})
    ) s WHERE h = ANY(${wanted})`;
  for (const { h, d } of blobs) avatarPool.set(h, d);
  // Only possible if a row was rewritten after the mirror synced. Fail the
  // read rather than rebuild a payload with a hole in it; the next sync sees
  // the new xmin and starts over.
  if (wanted.some((h) => !avatarPool.has(h))) {
    throw new Error('finished_games changed during sync — retry');
  }
}

/** The row's payload parsed from its exact stored text (avatars loaded first). */
function fullPayload(entry) {
  if (entry.fullParsed === undefined) entry.fullParsed = parsePayload(restorePayloadText(entry));
  return entry.fullParsed;
}

/**
 * The payload parsed with avatars nulled — for readers that never look at
 * avatars (stats, leaderboards, the score app's online history). Saves
 * rebuilding and re-parsing a few hundred KB of base64 per game.
 */
function barePayload(entry) {
  if (entry.bareParsed === undefined) {
    entry.bareParsed = parsePayload(entry.text.replace(AVATAR_SLOT_RE, '"avatar":null'));
  }
  return entry.bareParsed;
}

/** Mirror entries for a mode and type, newest first (the ORDER BY played_at DESC). */
async function gameEntries(mode, type = 'all') {
  await gameMirror.sync();
  return [...gameMirror.entries.values()]
    .filter((e) => matchesMode(e.is_championship, mode) && matchesType(e.type, type))
    .sort((a, b) => b.playedAtMs - a.playedAtMs);
}

function limitGames(entries, limit) {
  // `limit=all` (or any non-numeric truthy string starting with 'a') returns
  // every finished game. Used by the Hall-of-Fame leaderboard so its
  // per-player aggregates and graphs include the full history. All other
  // callers get a bounded query.
  const wantAll = typeof limit === 'string' && limit.toLowerCase().startsWith('a');
  if (wantAll) return entries;
  const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  return entries.slice(0, safeLimit);
}

/**
 * Finished games, newest first. `avatars: false` gives every player's
 * `avatar` as null — only for callers that strip or ignore avatars anyway.
 * The returned objects are shared with the mirror — read them, never mutate.
 */
async function listGames(limit = 50, mode = 'all', type = 'all', { avatars = true } = {}) {
  const entries = limitGames(await gameEntries(mode, type), limit);
  if (!avatars) {
    return entries.map((e) => {
      if (!e.bareGame) e.bareGame = rowToGame(e, barePayload(e));
      return e.bareGame;
    });
  }
  await loadAvatars(entries);
  return entries.map((e) => {
    if (!e.fullGame) e.fullGame = rowToGame(e, fullPayload(e));
    return e.fullGame;
  });
}

/** listGames without photos (every `avatar` null). */
function listGamesWithoutAvatars(limit = 50, mode = 'all', type = 'all') {
  return listGames(limit, mode, type, { avatars: false });
}

/** One game, without photos (null when there's no such game). */
async function getGameWithoutAvatars(id) {
  await gameMirror.sync();
  const e = gameMirror.entries.get(id);
  if (!e) return null;
  if (!e.bareGame) e.bareGame = rowToGame(e, barePayload(e));
  return e.bareGame;
}

async function getGame(id) {
  const rows = await db()`
    SELECT id, type, played_at, winner_name, winner_seat, winner_score, is_championship, payload
    FROM finished_games WHERE id = ${id} LIMIT 1`;
  return rows.length ? rowToGame(rows[0], parsePayload(rows[0].payload)) : null;
}

/**
 * A King Online game the game server just finished (its only writer).
 * `tournamentId` marks a bracket table: those count as league games but not
 * toward the daily quota.
 */
async function saveFinishedGame(record) {
  if (!record || !record.winner || !Array.isArray(record.players) || record.players.length !== 3
      || record.players.some((p) => !p || typeof p.name !== 'string' || !p.name || p.name.length > 64
        || !Number.isFinite(p.score))) {
    throw new Error('Invalid game record');
  }
  const id = record.id || `g_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const playedAt = record.playedAt
    ? new Date(record.playedAt)
    : new Date();

  // `winners` covers ties: every player who finished on the top score. The
  // legacy `winner` (single) columns stay for backward compatibility — they
  // always hold the first (lowest-seat) winner.
  const winners = Array.isArray(record.winners) && record.winners.length
    ? record.winners.map((w) => ({ seat: w.seat ?? 0, name: w.name, score: w.score ?? 0 }))
    : [{ seat: record.winner.seat ?? 0, name: record.winner.name, score: record.winner.score ?? 0 }];

  const isChampionship = record.isChampionship ? 1 : 0;

  const payload = JSON.stringify({
    players: record.players,
    roundDetails: record.roundDetails || [],
    winners,
    isTie: winners.length > 1,
    ...(record.tournamentId && { tournamentId: String(record.tournamentId) }),
  });

  // ON CONFLICT DO NOTHING makes a retry after an unclear failure safe.
  // played_at is kept to whole seconds like the old DATETIME column.
  await db()`
    INSERT INTO finished_games
      (id, played_at, winner_name, winner_seat, winner_score, is_championship, payload)
    VALUES (
      ${id},
      date_trunc('second', ${playedAt}::timestamptz),
      ${String(record.winner.name ?? '').slice(0, 64)},
      ${record.winner.seat ?? 0},
      ${record.winner.score ?? 0},
      ${isChampionship},
      ${payload}
    )
    ON CONFLICT DO NOTHING`;

  return getGame(id);
}

/** A game ჩაწერა just finished (see server/games/scoreSheet.js). */
async function saveScoreSheetGame(body) {
  const ids = (Array.isArray(body?.players) ? body.players : [])
    .map((p) => p && p.id).filter((id) => typeof id === 'string' && id.length <= 64);
  const byId = new Map();
  if (ids.length) {
    for (const p of await db()`SELECT id, name FROM profiles WHERE id = ANY(${ids})`) byId.set(p.id, p);
  }
  // A player removed (or renamed away) while the sheet was open is matched by
  // the name the sheet shows, and failing that kept by name alone, like the
  // old imported games — the game still saves.
  const names = (Array.isArray(body?.players) ? body.players : [])
    .filter((p) => p && typeof p.id === 'string' && !byId.has(p.id) && typeof p.name === 'string')
    .map((p) => p.name.trim().slice(0, 64)).filter(Boolean);
  const byName = new Map();
  if (names.length) {
    for (const p of await db()`
      SELECT id, name FROM profiles WHERE lower(name) = ANY(${names.map((n) => n.toLowerCase())})`) {
      byName.set(p.name.toLowerCase(), p);
    }
  }
  const row = fromScoreSheet(body, (id, name) => {
    if (byId.has(id)) return byId.get(id);
    const clean = typeof name === 'string' ? name.trim().slice(0, 64) : '';
    if (!clean) return null;
    return byName.get(clean.toLowerCase()) || { id: null, name: clean };
  });
  await db()`
    INSERT INTO finished_games
      (id, type, played_at, winner_name, winner_seat, winner_score, is_championship, payload)
    VALUES (${row.id}, 'live', now(), ${String(row.winner.name).slice(0, 64)}, ${row.winner.seat},
            ${row.winner.score}, ${row.isChampionship}, ${JSON.stringify(row.payload)})
    ON CONFLICT (id) DO NOTHING`;
  return getGame(row.id);
}

/** A finished_games row (or mirror entry) and its parsed payload, as the API serves it. */
function rowToGame(row, parsed) {
  let payload = {};
  if (parsed.ok) payload = parsed.value;
  const winner = {
    name: row.winner_name,
    seat: row.winner_seat,
    score: row.winner_score,
  };
  // Pre-tie-support rows have no `winners` in the payload — synthesise a
  // single-entry list from the winner columns so consumers can always rely
  // on `winners` being present.
  const winners = Array.isArray(payload.winners) && payload.winners.length
    ? payload.winners
    : [winner];
  return {
    id: row.id,
    playedAt: iso(row.played_at),
    winner,
    winners,
    isTie: winners.length > 1,
    isChampionship: row.is_championship === undefined ? true : !!row.is_championship,
    type: row.type || 'online',
    players: payload.players || [],
    roundDetails: payload.roundDetails || [],
    // ჩაწერა games only: how long the sheet was open, and what its old rows
    // need to be rebuilt exactly (see src/score/lib/gameShapes.js).
    ...(payload.durationSeconds != null && { durationSeconds: payload.durationSeconds }),
    ...(payload.legacy && { legacy: payload.legacy }),
    // A ჩაწერა game someone surrendered before the last round.
    ...(payload.surrenderedBySeat != null && { surrenderedBySeat: payload.surrenderedBySeat }),
  };
}

async function getLifetimeStats(name, mode = 'all', type = 'all') {
  if (!name) throw badRequest('name is required');
  const rows = await gameEntries(mode, type);
  const out = { name, gamesPlayed: 0, wins: 0, totalScore: 0, ...emptyRoundStats() };
  for (const row of rows) {
    const parsed = barePayload(row);
    if (!parsed.ok) continue;
    const payload = parsed.value;
    const me = (payload.players || []).find((p) => p.name === name);
    if (!me) continue;
    out.gamesPlayed += 1;
    // Tie-aware: a game may have several winners (payload.winners). Rows
    // saved before ties only have the winner_name column.
    if (winnerNames({ winners: payload.winners, winner_name: row.winner_name }).includes(name)) out.wins += 1;
    out.totalScore += me.score ?? 0;
    for (const d of payload.roundDetails || []) addRoundStats(out, d, me.seat);
  }
  return out;
}

/**
 * Daily championship quota for one player name (server-local calendar day,
 * APP_TIMEZONE). A "played" game is a finished King Online championship game
 * the player participated in — surrendered games count too, so abandoning a
 * match doesn't refund the slot. Games recorded in ჩაწერა and tournament
 * tables never count.
 */
async function getChampionshipQuota(name) {
  if (!name) throw badRequest('name is required');
  // Only names are needed, so avatars are dropped before leaving the database.
  const rows = await db()`
    SELECT regexp_replace(payload, ${AVATAR_RE_SQL}, '"avatar":null', 'g') AS payload
      FROM finished_games
     WHERE is_championship = 1
       AND type = 'online'
       AND played_at >= (date_trunc('day', now() AT TIME ZONE ${APP_TIMEZONE}) AT TIME ZONE ${APP_TIMEZONE})`;
  const lower = String(name).trim().toLowerCase();
  let playedToday = 0;
  for (const row of rows) {
    let payload = {};
    try { payload = JSON.parse(row.payload); } catch { continue; }
    if (payload.tournamentId) continue;
    const played = (payload.players || []).some(
      (p) => String(p.name || '').toLowerCase() === lower
    );
    if (played) playedToday += 1;
  }
  return {
    name: String(name).trim(),
    limit: CHAMPIONSHIP_DAILY_LIMIT,
    playedToday,
    remaining: Math.max(0, CHAMPIONSHIP_DAILY_LIMIT - playedToday),
  };
}

module.exports = {
  CHAMPIONSHIP_DAILY_LIMIT,
  listGames, listGamesWithoutAvatars, getGame, getGameWithoutAvatars, saveFinishedGame, saveScoreSheetGame, rowToGame,
  getLifetimeStats, getChampionshipQuota,
  // for seasons.js
  gameEntries, barePayload,
};
