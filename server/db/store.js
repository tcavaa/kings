'use strict';

const crypto = require('crypto');
const { getSql } = require('./connection');
const { fromScoreSheet } = require('../games/scoreSheet');
const { ALL_TYPE_CODES: GAME_TYPE_CODES } = require('../game/constants');

// Every DATETIME the MySQL build wrote was wall-clock time on the cPanel box
// (Asia/Tbilisi), and the championship "calendar day" was that box's day.
// Postgres stores real instants, so the day boundary is computed in this zone.
const APP_TIMEZONE = process.env.APP_TIMEZONE || 'Asia/Tbilisi';

function hashPin(pin, profileId) {
  const normalised = String(pin || '').trim();
  return crypto
    .createHash('sha256')
    .update(`${profileId}:${normalised}`, 'utf8')
    .digest('hex');
}

function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4}$/.test(pin);
}

// Constant-time comparison so a wrong guess doesn't leak the right prefix.
function pinMatches(pinHash, pin, profileId) {
  if (!pinHash || !isValidPin(pin)) return false;
  const a = Buffer.from(pinHash, 'hex');
  const b = Buffer.from(hashPin(pin, profileId), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// A profile with a PIN can only be changed or removed by someone who knows it.
function assertPinOwner(pinHash, currentPin, profileId) {
  if (!pinHash || pinMatches(pinHash, currentPin, profileId)) return;
  const err = new Error('Wrong PIN');
  err.status = 403;
  throw err;
}

function db() {
  const s = getSql();
  if (!s) {
    const err = new Error(
      'Database is not configured. Set DATABASE_URL in your environment, then apply supabase/migrations.'
    );
    err.code = 'DB_NOT_CONFIGURED';
    throw err;
  }
  return s;
}

// ─── table mirrors ───────────────────────────────────────────────────────────
// `finished_games` rows embed every player's base64 avatar (~60 KB a row) and
// `profiles` carries the photos too. The MySQL build re-read them on every
// request, which cost nothing against a MySQL on the same box but would burn
// through Supabase's egress allowance over the network. So each process keeps
// a copy, and before EVERY read asks Postgres for (id, xmin) pairs only: new
// ids are fetched, vanished ids dropped, and a changed xmin (the row was
// rewritten) re-fetched. Readers therefore always see exactly what a fresh
// SELECT would return — the bulky columns just cross the wire once.
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
    // Chunked so a cold start never asks for the whole table in one go.
    for (let i = 0; i < want.length; i += 50) {
      const rows = await fetchRows(want.slice(i, i + 50));
      for (const row of await makeEntry(rows)) entries.set(row.id, row);
    }
  }

  function start() {
    running = pull().finally(() => { running = null; });
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

// ─── profiles ────────────────────────────────────────────────────────────────

const profileMirror = createMirror({
  fetchMarks: () => db()`SELECT id, xmin::text AS v FROM profiles`,
  fetchRows: (ids) => db()`
    SELECT id, xmin::text AS v, name, avatar, pin_hash, created_at, updated_at
    FROM profiles WHERE id = ANY(${ids})`,
  makeEntry: (rows) => rows,
});

async function listProfiles() {
  await profileMirror.sync();
  return [...profileMirror.entries.values()]
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map(rowToProfile);
}

async function getProfile(id) {
  await profileMirror.sync();
  const row = profileMirror.entries.get(id);
  return row ? rowToProfile(row) : null;
}

/**
 * Create or edit a profile. `avatar`: a data URL sets the photo, null removes
 * it, undefined keeps it. `pin`: '1234' sets, null/'' clears, undefined keeps.
 * Changing an existing profile's PIN logs every other device out of it.
 */
async function upsertProfile({ id, name, avatar, pin, currentPin }) {
  if (!id || typeof id !== 'string' || id.length > 64) throw badRequest('profile.id is required');
  if (!name || !name.trim()) throw badRequest('profile.name is required');
  const trimmed = name.trim().slice(0, 64);

  let nextPinHash; // undefined → leave alone, null → clear, string → set
  if (pin === undefined) {
    nextPinHash = undefined;
  } else if (pin === null || pin === '') {
    nextPinHash = null;
  } else {
    if (!isValidPin(pin)) throw badRequest('PIN must be exactly 4 digits.');
    nextPinHash = hashPin(pin, id);
  }

  await db().begin(async (tx) => {
    const existing = await tx`SELECT pin_hash FROM profiles WHERE id = ${id} FOR UPDATE`;
    if (existing.length) assertPinOwner(existing[0].pin_hash, currentPin, id);
    // Names identify players in every game, quota and seat, so one per person.
    const [clash] = await tx`
      SELECT 1 FROM profiles WHERE lower(name) = lower(${trimmed}) AND id <> ${id} LIMIT 1`;
    if (clash) {
      const err = new Error(`A player named "${trimmed}" already exists.`);
      err.status = 409;
      throw err;
    }

    if (existing.length === 0) {
      await tx`
        INSERT INTO profiles (id, name, avatar, pin_hash)
        VALUES (${id}, ${trimmed}, ${avatar || null}, ${nextPinHash || null})`;
      return;
    }
    const sets = { name: trimmed };
    if (avatar !== undefined) sets.avatar = avatar || null;
    if (nextPinHash !== undefined) sets.pin_hash = nextPinHash;
    await tx`UPDATE profiles SET ${tx(sets)} WHERE id = ${id}`;
    if (nextPinHash !== undefined && nextPinHash !== existing[0].pin_hash) {
      await tx`DELETE FROM profile_sessions WHERE profile_id = ${id}`;
    }
  });

  return getProfile(id);
}

async function verifyProfilePin(id, pin) {
  if (!id) return { ok: false, reason: 'not_found' };
  const profile = await getProfile(id);
  if (!profile) return { ok: false, reason: 'not_found' };
  if (!profile.pin_hash) return { ok: true, hadPin: false };
  return pinMatches(profile.pin_hash, pin, id)
    ? { ok: true, hadPin: true }
    : { ok: false, reason: 'bad_pin', hadPin: true };
}

async function deleteProfile(id, currentPin) {
  const rows = await db()`SELECT pin_hash FROM profiles WHERE id = ${id}`;
  if (!rows.length) return false;
  assertPinOwner(rows[0].pin_hash, currentPin, id);
  await db()`DELETE FROM profiles WHERE id = ${id}`;
  return true;
}

// ─── players: ჩაწერა's view of the same profiles ─────────────────────────────
// One player list for both apps. ჩაწერა only needs names (no photos), and can
// add a player — a profile without a PIN, which King Online shows like any
// other — or remove one it added. Profiles with a PIN belong to King Online.

async function listPlayers() {
  const rows = await db()`
    SELECT id, name, pin_hash IS NOT NULL AS has_pin, created_at FROM profiles ORDER BY name`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    has_pin: r.has_pin,
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
  }));
}

async function createPlayer(name) {
  const trimmed = String(name ?? '').trim().slice(0, 64);
  if (!trimmed) throw badRequest('Player name is required.');
  const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  // Names identify players in every game, so one name per person.
  const rows = await db()`
    INSERT INTO profiles (id, name)
    SELECT ${id}, ${trimmed}
     WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE lower(name) = lower(${trimmed}))
    RETURNING id, name, created_at`;
  if (!rows.length) {
    const err = new Error(`A player named "${trimmed}" already exists.`);
    err.status = 409;
    throw err;
  }
  const r = rows[0];
  return { id: r.id, name: r.name, has_pin: false, created_at: r.created_at.toISOString() };
}

/** /admin: remove any player. Their games stay, under their name. */
async function deletePlayer(id) {
  const res = await db()`DELETE FROM profiles WHERE id = ${id}`;
  return res.count > 0;
}

/** /admin: drop a player's PIN (they forgot it) and log out their devices. */
async function clearPlayerPin(id) {
  const res = await db()`UPDATE profiles SET pin_hash = NULL WHERE id = ${id}`;
  await db()`DELETE FROM profile_sessions WHERE profile_id = ${id}`;
  return res.count > 0;
}

// Profile photos are served from /api/profiles/:id/avatar rather than sent as
// base64 everywhere. `v` changes whenever the photo does, so the response can
// be cached forever.
function avatarVersion(row) {
  if (!row.avatar) return null;
  if (row.avatarV === undefined) {
    row.avatarV = crypto.createHash('md5').update(row.avatar).digest('hex').slice(0, 12);
  }
  return row.avatarV;
}

function avatarUrlOf(row) {
  const v = avatarVersion(row);
  return v ? `/api/profiles/${encodeURIComponent(row.id)}/avatar?v=${v}` : null;
}

/** `{ mime, buffer, version }` for a profile's photo, or null. */
async function getProfileAvatar(id) {
  await profileMirror.sync();
  const row = profileMirror.entries.get(id);
  const m = row?.avatar && /^data:(image\/[a-z]+);base64,(.+)$/.exec(row.avatar);
  if (!m) return null;
  return { mime: m[1], buffer: Buffer.from(m[2], 'base64'), version: avatarVersion(row) };
}

function rowToProfile(row) {
  return {
    id: row.id,
    name: row.name,
    avatar: avatarUrlOf(row),
    pin_hash: row.pin_hash || null,
    has_pin: !!row.pin_hash,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

// ─── profile sessions ────────────────────────────────────────────────────────
// A browser that picked a profile (with its PIN, when it has one) holds a
// random token; the game server resolves it to the profile before letting a
// socket play under that name. Only the token's sha256 is stored.

const SESSION_IDLE_DAYS = 180;
const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

async function createProfileSession(profileId) {
  const token = crypto.randomBytes(24).toString('base64url');
  await db()`
    INSERT INTO profile_sessions (token_hash, profile_id) VALUES (${tokenHash(token)}, ${profileId})`;
  return token;
}

/** The profile a session token belongs to, or null. */
async function profileForSession(token) {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  const rows = await db()`
    UPDATE profile_sessions SET last_used_at = now()
     WHERE token_hash = ${tokenHash(token)}
       AND last_used_at > now() - make_interval(days => ${SESSION_IDLE_DAYS})
    RETURNING profile_id`;
  return rows.length ? getProfile(rows[0].profile_id) : null;
}

/** The profile using this name (case-insensitive), or null. */
async function getProfileByName(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  await profileMirror.sync();
  for (const row of profileMirror.entries.values()) {
    if (row.name.toLowerCase() === wanted) return rowToProfile(row);
  }
  return null;
}

// ─── rate limits ─────────────────────────────────────────────────────────────
// Fixed-window failure counters for PIN and passcode guesses, in the database
// because serverless instances share no memory.

async function isRateLimited(key, max, windowSeconds) {
  const rows = await db()`
    SELECT hits FROM rate_limits
     WHERE key = ${key} AND window_start > now() - make_interval(secs => ${windowSeconds})`;
  return rows.length > 0 && rows[0].hits >= max;
}

async function recordFailure(key, windowSeconds) {
  await db()`
    INSERT INTO rate_limits (key, window_start, hits) VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      hits = CASE WHEN rate_limits.window_start > now() - make_interval(secs => ${windowSeconds})
                  THEN rate_limits.hits + 1 ELSE 1 END,
      window_start = CASE WHEN rate_limits.window_start > now() - make_interval(secs => ${windowSeconds})
                          THEN rate_limits.window_start ELSE now() END`;
  // Keep the table small: forget windows older than a day now and then.
  if (Math.random() < 0.05) {
    await db()`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`;
  }
}

// ─── finished games ──────────────────────────────────────────────────────────

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
// distinct avatars live once in `avatarPool`. Re-inserting them in order
// rebuilds the stored text byte for byte. A raw U+0001 can never occur in
// JSON.stringify output (control characters are always escaped), so the
// marker cannot collide with real data.
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
  fetchRows: async (ids) => {
    const sql = db();
    const rows = await sql`
      SELECT id, xmin::text AS v, type, played_at, winner_name, winner_seat, winner_score,
             is_championship,
             regexp_replace(payload, ${AVATAR_RE_SQL}, ${AVATAR_SLOT_TEXT}, 'g') AS text,
             ARRAY(
               SELECT md5(m.r[1])
                 FROM regexp_matches(payload, ${AVATAR_RE_SQL}, 'g') WITH ORDINALITY AS m(r, n)
                ORDER BY m.n
             ) AS avatar_hashes
        FROM finished_games WHERE id = ANY(${ids})`;
    const missing = [...new Set(rows.flatMap((r) => r.avatar_hashes))]
      .filter((h) => !avatarPool.has(h));
    if (missing.length) {
      const blobs = await sql`
        SELECT DISTINCT ON (h) h, d FROM (
          SELECT md5(m[1]) AS h, m[1] AS d
            FROM finished_games, regexp_matches(payload, ${AVATAR_RE_SQL}, 'g') AS m
           WHERE id = ANY(${ids})
        ) s WHERE h = ANY(${missing})`;
      for (const { h, d } of blobs) avatarPool.set(h, d);
      // Only possible if a row was rewritten between the two queries. Fail
      // the read rather than rebuild a payload with a hole in it; the next
      // sync sees the new xmin and starts over.
      if (missing.some((h) => !avatarPool.has(h))) {
        throw new Error('finished_games changed during sync — retry');
      }
    }
    return rows;
  },
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

/** The row's payload parsed from its exact stored text. */
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

// The returned objects are shared with the mirror — read them, never mutate.
async function listGames(limit = 50, mode = 'all', type = 'all') {
  return limitGames(await gameEntries(mode, type), limit).map((e) => {
    if (!e.fullGame) e.fullGame = rowToGame(e, fullPayload(e));
    return e.fullGame;
  });
}

/**
 * Same rows, order and limit as listGames, but every player's `avatar` is
 * null. Only for callers that strip or ignore avatars anyway.
 */
async function listGamesWithoutAvatars(limit = 50, mode = 'all', type = 'all') {
  return limitGames(await gameEntries(mode, type), limit).map((e) => {
    if (!e.bareGame) e.bareGame = rowToGame(e, barePayload(e));
    return e.bareGame;
  });
}

async function getGame(id) {
  const rows = await db()`
    SELECT id, type, played_at, winner_name, winner_seat, winner_score, is_championship, payload
    FROM finished_games WHERE id = ${id} LIMIT 1`;
  return rows.length ? rowToGame(rows[0], parsePayload(rows[0].payload)) : null;
}

/** A King Online game the game server just finished (its only writer). */
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
    .map((p) => p && p.id).filter((id) => typeof id === 'string');
  const byId = new Map();
  if (ids.length) {
    for (const p of await db()`SELECT id, name FROM profiles WHERE id = ANY(${ids})`) byId.set(p.id, p);
  }
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) {
    // A game started before the player lists were merged still carries
    // ჩაწერა's old player ids; those map to profiles through online_name.
    const [{ schema } = {}] = await db()`
      SELECT table_schema AS schema FROM information_schema.tables
       WHERE table_name = 'players' AND table_schema IN ('public', 'legacy') LIMIT 1`;
    if (schema) {
      const rows = await db()`
        SELECT pl.id::text AS old_id, pr.id, pr.name
          FROM ${db()(`${schema}.players`)} pl JOIN profiles pr ON pr.name = pl.online_name
         WHERE pl.id::text = ANY(${unknown})`;
      for (const r of rows) byId.set(r.old_id, { id: r.id, name: r.name });
    }
  }
  const row = fromScoreSheet(body, (id) => byId.get(id) || null);
  await db()`
    INSERT INTO finished_games
      (id, type, played_at, winner_name, winner_seat, winner_score, is_championship, payload)
    VALUES (${row.id}, 'live', now(), ${String(row.winner.name).slice(0, 64)}, ${row.winner.seat},
            ${row.winner.score}, ${row.isChampionship}, ${JSON.stringify(row.payload)})`;
  return getGame(row.id);
}

function rowToGame(row, parsed) {
  let payload = {};
  if (parsed.ok) payload = parsed.value;
  const playedAt = row.played_at instanceof Date
    ? row.played_at.toISOString()
    : row.played_at;
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
    playedAt,
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
  };
}

async function getLifetimeStats(name, mode = 'all', type = 'all') {
  if (!name) throw new Error('name is required');
  const rows = await gameEntries(mode, type);
  const out = {
    name,
    gamesPlayed: 0, wins: 0, totalScore: 0,
    kingsOfHearts: 0, queens: 0, jacks: 0, hearts: 0,
    totalTricks: 0, roundsLed: 0,
  };
  for (const row of rows) {
    const parsed = barePayload(row);
    if (!parsed.ok) continue;
    const payload = parsed.value;
    const me = (payload.players || []).find((p) => p.name === name);
    if (!me) continue;
    out.gamesPlayed += 1;
    // Tie-aware: a game may have several winners (payload.winners). Fall
    // back to the single winner_name column for rows saved before ties.
    const winnerNames = Array.isArray(payload.winners) && payload.winners.length
      ? payload.winners.map((w) => w.name)
      : [row.winner_name];
    if (winnerNames.includes(name)) out.wins += 1;
    out.totalScore += me.score ?? 0;
    for (const d of payload.roundDetails || []) {
      if (d.leaderSeat === me.seat) out.roundsLed += 1;
      out.totalTricks += d.tricksTaken?.[me.seat] ?? 0;
      if (d.gameType === 'Q') out.queens += d.queensTaken?.[me.seat] ?? 0;
      if (d.gameType === 'J') out.jacks  += d.jacksTaken?.[me.seat]  ?? 0;
      if (d.gameType === 'H') out.hearts += d.heartsTaken?.[me.seat] ?? 0;
      if (d.gameType === 'K' && d.kingOfHeartsTakenBy === me.seat) out.kingsOfHearts += 1;
    }
  }
  return out;
}

// ─── live games (mid-flight rooms persisted for crash/rejoin recovery) ───────
// Snapshots are written fire-and-forget after every action. Against a remote
// database two writes for the same room could otherwise overtake each other on
// different pool connections — and a stale snapshot landing after the
// game-over delete would resurrect a finished room. So every operation on a
// room's row runs strictly in call order.
const liveQueues = new Map(); // roomCode -> tail of that room's operation chain

function inRoomOrder(roomCode, fn) {
  const prev = liveQueues.get(roomCode) || Promise.resolve();
  const run = prev.then(fn);
  const tail = run.catch(() => {});
  liveQueues.set(roomCode, tail);
  tail.then(() => { if (liveQueues.get(roomCode) === tail) liveQueues.delete(roomCode); });
  return run;
}

async function saveLiveGame(roomCode, snapshot) {
  if (!roomCode || !snapshot) return;
  const stateJson = JSON.stringify(snapshot);
  await inRoomOrder(roomCode, () => db()`
    INSERT INTO live_games (room_code, state_json) VALUES (${roomCode}, ${stateJson})
    ON CONFLICT (room_code) DO UPDATE SET state_json = EXCLUDED.state_json`);
}

async function loadLiveGame(roomCode) {
  const rows = await inRoomOrder(roomCode, () => db()`
    SELECT state_json FROM live_games WHERE room_code = ${roomCode} LIMIT 1`);
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].state_json); }
  catch { return null; }
}

async function deleteLiveGame(roomCode) {
  await inRoomOrder(roomCode, () => db()`DELETE FROM live_games WHERE room_code = ${roomCode}`);
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

/**
 * Daily championship quota for one player name (server-local calendar day,
 * APP_TIMEZONE). A "played" game is a finished King Online championship game
 * the player participated in — surrendered games count too, so abandoning a
 * match doesn't refund the slot. Games recorded in ჩაწერა never count.
 */
async function getChampionshipQuota(name) {
  if (!name) throw new Error('name is required');
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

// ─── seasons (King Score's, read by both apps) ───────────────────────────────

// The current season is the one row with ended_at NULL. Setups older than that
// row have none; their current season simply starts when the last one ended.
// Seasons count every ჩაწერა game and King Online's championship games.

const SEASON_THEMES = ['casual', 'summer', 'mountain', 'christmas'];

async function listSeasons() {
  const rows = await db()`
    SELECT id, name, theme, started_at, ended_at, champion_name FROM seasons ORDER BY started_at DESC`;
  const iso = (v) => (v instanceof Date ? v.toISOString() : v);
  return rows.map((r) => ({ ...r, started_at: iso(r.started_at), ended_at: iso(r.ended_at) }));
}

async function currentSeason(sql = db()) {
  const rows = await sql`SELECT id, name, theme, started_at, ended_at FROM seasons`;
  const open = rows.find((r) => !r.ended_at) || null;
  const lastEnded = rows.filter((r) => r.ended_at).sort((a, b) => b.ended_at - a.ended_at)[0];
  const start = open?.started_at || lastEnded?.ended_at || new Date(0);
  return { open, start: new Date(start) };
}

/** Wins per player since `start`, and the champion(s) ("A & B" on a tie). */
async function seasonStandings(start) {
  const startMs = start.getTime();
  const wins = new Map();
  let firstGameMs = null;
  for (const e of await gameEntries('all', 'all')) {
    if (e.playedAtMs <= startMs) continue;
    if (e.type !== 'live' && e.is_championship !== 1) continue;
    firstGameMs = firstGameMs === null ? e.playedAtMs : Math.min(firstGameMs, e.playedAtMs);
    const parsed = barePayload(e);
    const names = parsed.ok && Array.isArray(parsed.value.winners) && parsed.value.winners.length
      ? parsed.value.winners.map((w) => w.name)
      : [e.winner_name];
    for (const name of new Set(names.filter(Boolean))) wins.set(name, (wins.get(name) || 0) + 1);
  }
  const table = [...wins].map(([name, count]) => ({ name, wins: count }))
    .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));
  const best = table[0]?.wins;
  const champion = table.length
    ? table.filter((r) => r.wins === best).map((r) => r.name).sort().join(' & ')
    : null;
  return { table, champion, firstGameAt: firstGameMs === null ? null : new Date(firstGameMs) };
}

/** /admin: what ending the season now would record. */
async function previewSeasonEnd() {
  const { open, start } = await currentSeason();
  const { table, champion } = await seasonStandings(start);
  return { season: open, startedAt: start.toISOString(), champion, table };
}

function seasonFields({ name, theme }) {
  const cleanName = String(name ?? '').trim();
  if (!cleanName || cleanName.length > 40) throw badRequest('Season name must be 1-40 characters.');
  if (!SEASON_THEMES.includes(theme)) throw badRequest('Unknown season theme.');
  return { name: cleanName, theme };
}

/** /admin: close the current season with its champion and open the next one. */
async function endSeason({ name, theme }) {
  const next = seasonFields({ name, theme });
  return db().begin(async (tx) => {
    // One season end at a time; a second click waits and then finds no games.
    await tx`LOCK TABLE seasons IN SHARE ROW EXCLUSIVE MODE`;
    const { open, start } = await currentSeason(tx);
    const { champion, firstGameAt } = await seasonStandings(start);
    if (!champion) throw badRequest('No games in the current season yet.');
    if (open) {
      await tx`UPDATE seasons SET champion_name = ${champion}, ended_at = now() WHERE id = ${open.id}`;
    } else {
      await tx`
        INSERT INTO seasons (champion_name, started_at, ended_at)
        VALUES (${champion}, ${firstGameAt || start}, now())`;
    }
    await tx`INSERT INTO seasons (name, theme, started_at) VALUES (${next.name}, ${next.theme}, now())`;
    return { champion };
  });
}

/** /admin: rename or re-theme the current season. */
async function updateCurrentSeason({ name, theme }) {
  const fields = seasonFields({ name, theme });
  const { open, start } = await currentSeason();
  if (open) {
    await db()`UPDATE seasons SET name = ${fields.name}, theme = ${fields.theme} WHERE id = ${open.id}`;
  } else {
    await db()`INSERT INTO seasons (name, theme, started_at) VALUES (${fields.name}, ${fields.theme}, ${start})`;
  }
}

// ─── live score sheets: ჩაწერა games in progress, for others to follow ──────

const LIVE_SHEET_HOURS = 3;
const SHEET_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Every viewer renders these rounds, so they are rebuilt field by field: one
// malformed round must never reach a client.
function sheetRound(r, ids) {
  const plain = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const keyedBy = (obj, ok) => plain(obj) && Object.entries(obj).every(([k, v]) => ids.has(k) && ok(v));
  if (!plain(r) || !GAME_TYPE_CODES.includes(r.gameTypeCode) || !ids.has(r.leaderPlayerId)
      || !keyedBy(r.scores, (v) => Number.isInteger(v) && Math.abs(v) <= 1000)) {
    throw badRequest('Invalid score sheet round.');
  }
  const counts = r.countsByPlayerId ?? null;
  if (counts !== null && !keyedBy(counts, (v) => Number.isInteger(v) && v >= 0 && v <= 10)) {
    throw badRequest('Invalid score sheet round.');
  }
  const target = r.singleTargetPlayerId ?? null;
  if (target !== null && !ids.has(target)) throw badRequest('Invalid score sheet round.');
  return {
    gameTypeCode: r.gameTypeCode,
    leaderPlayerId: r.leaderPlayerId,
    scores: { ...r.scores },
    countsByPlayerId: counts && { ...counts },
    singleTargetPlayerId: target,
  };
}

function sheetState(state) {
  const players = Array.isArray(state?.players) ? state.players : null;
  const rounds = Array.isArray(state?.rounds) ? state.rounds : null;
  if (!players || players.length < 3 || players.length > 4 || !rounds || rounds.length > 36
      || players.some((p) => !p || typeof p.id !== 'string' || !p.id || p.id.length > 64
        || typeof p.name !== 'string' || p.name.length > 64)) {
    throw badRequest('Invalid score sheet.');
  }
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) throw badRequest('Invalid score sheet.');
  const clean = {
    players: players.map((p) => ({ id: p.id, name: p.name })),
    rounds: rounds.map((r) => sheetRound(r, ids)),
    activePlayerIndex: Number.isInteger(state.activePlayerIndex) ? state.activePlayerIndex : 0,
    startedAt: Number.isFinite(state.startedAt) ? state.startedAt : null,
    endedAt: Number.isFinite(state.endedAt) ? state.endedAt : null,
  };
  const text = JSON.stringify(clean);
  if (text.length > 100 * 1024) throw badRequest('Score sheet is too large.');
  return text;
}

async function saveLiveSheet(id, state) {
  if (!SHEET_ID_RE.test(String(id))) throw badRequest('Invalid sheet id.');
  const text = sheetState(state);
  await db()`
    INSERT INTO live_sheets (id, state, updated_at) VALUES (${id}, ${text}, now())
    ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`;
}

async function deleteLiveSheet(id) {
  await db()`DELETE FROM live_sheets WHERE id = ${String(id)}`;
}

/** Sheets touched in the last few hours, most recently updated first. */
async function listLiveSheets() {
  const rows = await db()`
    SELECT id, state, updated_at FROM live_sheets
     WHERE updated_at > now() - make_interval(hours => ${LIVE_SHEET_HOURS})
     ORDER BY updated_at DESC`;
  const out = [];
  for (const r of rows) {
    try { out.push({ id: r.id, updatedAt: r.updated_at.toISOString(), ...JSON.parse(r.state) }); }
    catch { /* ignore a malformed row */ }
  }
  return out;
}

// ─── sounds ──────────────────────────────────────────────────────────────────
// The reaction-clip catalogue. Built-in clips are files in the front-end
// build (`/sounds/<id>.mp3`); admin uploads keep their bytes in the row.

// Clip payload ceiling. Reaction clips are a couple of seconds of speech —
// 2 MB is already luxurious, and every byte is base64 in a text column that
// gets read whenever the clip is served.
const MAX_SOUND_BYTES = 2 * 1024 * 1024;

const SOUND_MIMES = {
  'audio/mpeg': 'mp3',
  'audio/mp3':  'mp3',
  'audio/ogg':  'ogg',
  'audio/wav':  'wav',
  'audio/x-wav':'wav',
  'audio/webm': 'webm',
  'audio/mp4':  'm4a',
  'audio/aac':  'aac',
};

/** Row → the shape the API hands out. Never includes the audio payload. */
function rowToSound(r) {
  return {
    id: r.id,
    label: r.label,
    glyph: r.glyph || '?',
    color: r.color || '#8e6a1e',
    source: r.source,
    // Built-ins keep pointing at the static file that ships with the build;
    // uploads stream out of the database. `v` busts the browser cache when an
    // admin replaces a clip's audio under the same id.
    url: r.source === 'builtin'
      ? `/sounds/${encodeURIComponent(r.id)}.mp3`
      : `/api/sounds/${encodeURIComponent(r.id)}/audio?v=${new Date(r.updated_at).getTime()}`,
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  };
}

async function listSounds() {
  const rows = await db()`
    SELECT id, label, glyph, color, source, sort_order, updated_at
    FROM sounds ORDER BY sort_order ASC, id ASC`;
  return rows.map(rowToSound);
}

/** Just the ids — what the socket layer needs to validate a `play-sound`. */
async function listSoundIds() {
  const rows = await db()`SELECT id FROM sounds`;
  return rows.map((r) => r.id);
}

/** `{ mime, buffer }` for an uploaded clip, or null. */
async function getSoundAudio(id) {
  const rows = await db()`
    SELECT mime, audio_b64 FROM sounds WHERE id = ${id} AND source = 'uploaded' LIMIT 1`;
  if (!rows.length || !rows[0].audio_b64) return null;
  return {
    mime: rows[0].mime || 'audio/mpeg',
    buffer: Buffer.from(rows[0].audio_b64, 'base64'),
  };
}

/**
 * Turn an uploaded `data:audio/...;base64,...` URL into `{ mime, b64, ext }`.
 * Throws a 4xx-tagged error on anything that isn't plausible audio.
 */
function parseAudioDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') throw badRequest('audio must be a data URL string');
  const m = /^data:([a-z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl.trim());
  if (!m) throw badRequest('audio must be a base64 data URL');
  const mime = m[1].toLowerCase();
  const ext = SOUND_MIMES[mime];
  if (!ext) throw badRequest(`unsupported audio type: ${mime}`);
  const b64 = m[2];
  const bytes = Math.floor(b64.length * 3 / 4);
  if (bytes === 0) throw badRequest('audio file is empty');
  if (bytes > MAX_SOUND_BYTES) {
    throw badRequest(`audio is too large (max ${Math.round(MAX_SOUND_BYTES / 1024)} KB)`);
  }
  return { mime, b64, ext };
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

// Palette the admin form cycles through when no colour is picked. Same
// saloon tones as the hand-authored built-ins.
const SOUND_COLORS = [
  '#b98a2f', '#a5372b', '#4c7a2f', '#31536b', '#6b3fa0', '#5b3d99',
  '#a83a68', '#8e6a1e', '#b0446e', '#2f5d8a', '#2b7a55', '#9c7818',
  '#b04a52', '#9c5a24', '#a97b14', '#22758a', '#5e7a1e',
];

/**
 * Derive a wire id from the clip's name. The name is usually Georgian, which
 * has no ASCII form, so anything that doesn't reduce to a usable slug falls
 * back to a short random token. Uniqueness is settled against the table.
 */
async function _uniqueSoundId(label) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const seed = base || `snd-${crypto.randomBytes(4).toString('hex')}`;
  const rows = await db()`SELECT id FROM sounds`;
  const taken = new Set(rows.map((r) => r.id));
  if (!taken.has(seed)) return seed;
  for (let n = 2; n < 500; n++) {
    const candidate = `${seed}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${seed}-${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * Add an uploaded clip. `label` and `audio` (a data URL) are required;
 * `glyph` and `color` are derived from the label when not supplied so the
 * admin form can be just "name + file".
 */
async function createSound({ label, audio, glyph, color } = {}) {
  const name = String(label || '').trim();
  if (!name) throw badRequest('name is required');
  if (name.length > 64) throw badRequest('name is too long (max 64 characters)');
  const { mime, b64 } = parseAudioDataUrl(audio);

  const id = await _uniqueSoundId(name);
  // First character of the name reads well on the tiny canvas buttons —
  // that's exactly the convention the hand-authored glyphs followed.
  const finalGlyph = (typeof glyph === 'string' && glyph.trim())
    ? [...glyph.trim()][0]
    : ([...name][0] || '?');
  const finalColor = /^#[0-9a-f]{6}$/i.test(String(color || ''))
    ? color
    : SOUND_COLORS[Math.abs(_hashCode(id)) % SOUND_COLORS.length];

  const [{ maxOrder }] = await db()`
    SELECT COALESCE(MAX(sort_order), 0) AS "maxOrder" FROM sounds`;

  await db()`
    INSERT INTO sounds (id, label, glyph, color, source, mime, audio_b64, sort_order)
    VALUES (${id}, ${name}, ${finalGlyph}, ${finalColor}, 'uploaded', ${mime}, ${b64},
            ${Number(maxOrder) + 10})`;
  return getSound(id);
}

function _hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

async function getSound(id) {
  const rows = await db()`
    SELECT id, label, glyph, color, source, sort_order, updated_at
    FROM sounds WHERE id = ${id} LIMIT 1`;
  return rows.length ? rowToSound(rows[0]) : null;
}

/**
 * Edit an existing clip. Every field is optional — only what's passed is
 * touched. Replacing `audio` on a built-in promotes it to 'uploaded' (the
 * static file stays on disk, unused).
 */
async function updateSound(id, { label, glyph, color, audio } = {}) {
  const existing = await getSound(id);
  if (!existing) return null;

  const sets = {};
  if (label !== undefined) {
    const name = String(label || '').trim();
    if (!name) throw badRequest('name cannot be empty');
    if (name.length > 64) throw badRequest('name is too long (max 64 characters)');
    sets.label = name;
  }
  if (glyph !== undefined) {
    const g = String(glyph || '').trim();
    sets.glyph = g ? [...g][0] : '?';
  }
  if (color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(String(color || ''))) throw badRequest('color must be a #rrggbb hex string');
    sets.color = color;
  }
  if (audio !== undefined && audio !== null) {
    const { mime, b64 } = parseAudioDataUrl(audio);
    sets.mime = mime;
    sets.audio_b64 = b64;
    sets.source = 'uploaded';
  }
  if (!Object.keys(sets).length) return existing;

  const sql = db();
  await sql`UPDATE sounds SET ${sql(sets)} WHERE id = ${id}`;
  return getSound(id);
}

/**
 * Persist a new button order. `ids` is the full catalogue, front to back;
 * anything missing from it keeps its old slot number and just sorts after
 * (or between) the rewritten ones, so a partial list can't silently reshuffle
 * the rest.
 *
 * `updated_at` must not move here: it is the `?v=` cache-buster in each
 * clip's url, and bumping it on every drag would make every client
 * re-download the whole library after a reorder. Position isn't content (the
 * touch trigger ignores sort_order for exactly this reason).
 */
async function reorderSounds(ids) {
  if (!Array.isArray(ids) || ids.length === 0) throw badRequest('ids must be a non-empty array');
  if (ids.some((id) => typeof id !== 'string')) throw badRequest('ids must all be strings');
  await db().begin(async (tx) => {
    for (let i = 0; i < ids.length; i++) {
      await tx`
        UPDATE sounds SET sort_order = ${(i + 1) * 10}, updated_at = updated_at
         WHERE id = ${ids[i]}`;
    }
  });
  return listSounds();
}

async function deleteSound(id) {
  const res = await db()`DELETE FROM sounds WHERE id = ${id}`;
  return res.count > 0;
}

module.exports = {
  // profiles, their photos and sessions
  listProfiles, getProfile, getProfileByName, upsertProfile, deleteProfile, verifyProfilePin,
  getProfileAvatar, createProfileSession, profileForSession,
  // the same profiles as ჩაწერა's player list (managed from /admin)
  listPlayers, createPlayer, deletePlayer, clearPlayerPin,
  // finished games (King Online's and ჩაწერა's)
  listGames, listGamesWithoutAvatars, getGame, saveFinishedGame, saveScoreSheetGame,
  // stats
  getLifetimeStats,
  // championship daily quota
  getChampionshipQuota, CHAMPIONSHIP_DAILY_LIMIT,
  // seasons (managed from /admin), and ჩაწერა score sheets in progress
  listSeasons, previewSeasonEnd, endSeason, updateCurrentSeason,
  listLiveSheets, saveLiveSheet, deleteLiveSheet,
  // live games (mid-flight rooms persisted for crash/rejoin recovery)
  saveLiveGame, loadLiveGame, deleteLiveGame, listLiveGames, purgeStaleLiveGames,
  // reaction sounds (admin-managed)
  listSounds, listSoundIds, getSoundAudio, createSound, updateSound, deleteSound,
  reorderSounds,
  // guess limits for PINs and the admin passcode
  isRateLimited, recordFailure,
};
