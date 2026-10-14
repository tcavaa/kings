'use strict';

// Profiles (one player list for both apps), their photos, PINs and the
// session tokens the game server checks.

const crypto = require('crypto');
const { db } = require('./connection');
const { createMirror, iso } = require('./mirror');
const { httpError, badRequest } = require('../lib/httpError');

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

// An existing profile can only be changed or removed by someone who knows
// its PIN. One without a PIN has nothing to prove ownership with, so only
// /admin may change it (and can give it a PIN).
function assertPinOwner(pinHash, currentPin, profileId) {
  if (!pinHash) throw httpError(403, 'This player has no PIN — ask the admin to set one.');
  if (pinMatches(pinHash, currentPin, profileId)) return;
  throw httpError(403, 'Wrong PIN');
}

// The photo's version without the photo: the same md5 avatarVersion takes,
// worked out by Postgres, so single-profile reads never download it.
const PROFILE_COLUMNS = 'id, name, pin_hash, created_at, updated_at, left(md5(avatar), 12) AS avatar_v';

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

/** One profile, read straight from the table (no photo crosses the wire). */
async function getProfile(id) {
  const [row] = await db()`SELECT ${db().unsafe(PROFILE_COLUMNS)} FROM profiles WHERE id = ${id}`;
  return row ? rowToProfile(row) : null;
}

/**
 * Create or edit a profile. `avatar`: a data URL sets the photo, null removes
 * it, undefined keeps it. `pin`: '1234' sets, null/'' clears, undefined keeps.
 * Changing an existing profile's PIN logs every other device out of it.
 */
// Tied winners are shown joined with " & ", so a name may not contain it.
function cleanName(name) {
  const trimmed = String(name ?? '').trim().slice(0, 64);
  if (/\s&\s/.test(trimmed)) throw badRequest('A name can\'t contain " & ".');
  return trimmed;
}

async function upsertProfile({ id, name, avatar, pin, currentPin }) {
  if (!id || typeof id !== 'string' || id.length > 64) throw badRequest('profile.id is required');
  if (!name || !name.trim()) throw badRequest('profile.name is required');
  const trimmed = cleanName(name);

  let nextPinHash; // undefined → leave alone, null → clear, string → set
  if (pin === undefined) {
    nextPinHash = undefined;
  } else if (pin === null || pin === '') {
    nextPinHash = null;
  } else {
    if (!isValidPin(pin)) throw badRequest('PIN must be exactly 4 digits.');
    nextPinHash = hashPin(pin, id);
  }

  return db().begin(async (tx) => {
    const existing = await tx`SELECT pin_hash FROM profiles WHERE id = ${id} FOR UPDATE`;
    if (existing.length) assertPinOwner(existing[0].pin_hash, currentPin, id);
    // Names identify players in every game, quota and seat, so one per person.
    const [clash] = await tx`
      SELECT 1 FROM profiles WHERE lower(name) = lower(${trimmed}) AND id <> ${id} LIMIT 1`;
    if (clash) throw httpError(409, `A player named "${trimmed}" already exists.`);

    let row;
    if (existing.length === 0) {
      [row] = await tx`
        INSERT INTO profiles (id, name, avatar, pin_hash)
        VALUES (${id}, ${trimmed}, ${avatar || null}, ${nextPinHash || null})
        RETURNING ${tx.unsafe(PROFILE_COLUMNS)}`;
    } else {
      const sets = { name: trimmed };
      if (avatar !== undefined) sets.avatar = avatar || null;
      if (nextPinHash !== undefined) sets.pin_hash = nextPinHash;
      [row] = await tx`UPDATE profiles SET ${tx(sets)} WHERE id = ${id} RETURNING ${tx.unsafe(PROFILE_COLUMNS)}`;
      if (nextPinHash !== undefined && nextPinHash !== existing[0].pin_hash) {
        await tx`DELETE FROM profile_sessions WHERE profile_id = ${id}`;
      }
    }
    return rowToProfile(row);
  });
}

async function verifyProfilePin(id, pin) {
  if (!id) return { ok: false, reason: 'not_found' };
  const [row] = await db()`SELECT pin_hash FROM profiles WHERE id = ${id}`;
  if (!row) return { ok: false, reason: 'not_found' };
  if (!row.pin_hash) return { ok: true, hadPin: false };
  return pinMatches(row.pin_hash, pin, id)
    ? { ok: true, hadPin: true }
    : { ok: false, reason: 'bad_pin', hadPin: true };
}

async function deleteProfile(id, currentPin) {
  const rows = await db()`SELECT pin_hash FROM profiles WHERE id = ${id}`;
  if (!rows.length) return false;
  const pinHash = rows[0].pin_hash;
  assertPinOwner(pinHash, currentPin, id);
  // Delete only the profile whose PIN was just checked: a PIN set in between
  // must not be bypassed by a check that ran before it.
  const res = pinHash
    ? await db()`DELETE FROM profiles WHERE id = ${id} AND pin_hash = ${pinHash}`
    : await db()`DELETE FROM profiles WHERE id = ${id} AND pin_hash IS NULL`;
  if (res.count === 0) throw httpError(409, 'The profile just changed — try again.');
  return true;
}

// ─── players: ჩაწერა's view of the same profiles ─────────────────────────────
// One player list for both apps. ჩაწერა only needs names (no photos). Players
// are added and removed from /admin; a player added there is a profile
// without a PIN, which King Online shows like any other.

async function listPlayers() {
  const rows = await db()`
    SELECT id, name, pin_hash IS NOT NULL AS has_pin, created_at FROM profiles ORDER BY name`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    has_pin: r.has_pin,
    created_at: iso(r.created_at),
  }));
}

async function createPlayer(name) {
  const trimmed = cleanName(name);
  if (!trimmed) throw badRequest('Player name is required.');
  const id = `p_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
  // Names identify players in every game, so one name per person.
  const rows = await db()`
    INSERT INTO profiles (id, name)
    SELECT ${id}, ${trimmed}
     WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE lower(name) = lower(${trimmed}))
    RETURNING id, name, created_at`;
  if (!rows.length) throw httpError(409, `A player named "${trimmed}" already exists.`);
  const r = rows[0];
  return { id: r.id, name: r.name, has_pin: false, created_at: iso(r.created_at) };
}

/** /admin: remove any player. Their games stay, under their name. */
async function deletePlayer(id) {
  const res = await db()`DELETE FROM profiles WHERE id = ${id}`;
  return res.count > 0;
}

/** /admin: give a player a PIN (e.g. one added without one) and log out their devices. */
async function setPlayerPin(id, pin) {
  if (!isValidPin(pin)) throw badRequest('PIN must be exactly 4 digits.');
  const res = await db()`UPDATE profiles SET pin_hash = ${hashPin(pin, id)} WHERE id = ${id}`;
  await db()`DELETE FROM profile_sessions WHERE profile_id = ${id}`;
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
  if (row.avatar_v !== undefined) return row.avatar_v || null;
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
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
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
  const wanted = String(name || '').trim();
  if (!wanted) return null;
  const [row] = await db()`
    SELECT ${db().unsafe(PROFILE_COLUMNS)} FROM profiles WHERE lower(name) = lower(${wanted}) LIMIT 1`;
  return row ? rowToProfile(row) : null;
}

module.exports = {
  assertPinOwner, listProfiles, getProfile, getProfileByName, upsertProfile, deleteProfile, verifyProfilePin,
  getProfileAvatar, createProfileSession, profileForSession,
  listPlayers, createPlayer, deletePlayer, clearPlayerPin, setPlayerPin,
};
