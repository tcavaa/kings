'use strict';

// ─── sounds ──────────────────────────────────────────────────────────────────
// The reaction-clip catalogue. Built-in clips are files in the front-end
// build (`/sounds/<id>.mp3`); admin uploads keep their bytes in the row.

const crypto = require('crypto');
const { db } = require('./connection');
const { badRequest } = require('../lib/httpError');

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

/** The `?v=` of an uploaded clip's url: changes whenever the row does. */
const soundVersion = (updatedAt) => String(new Date(updatedAt).getTime());

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
      : `/api/sounds/${encodeURIComponent(r.id)}/audio?v=${soundVersion(r.updated_at)}`,
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

/** The current `?v=` of an uploaded clip (without reading its bytes), or null. */
async function getSoundVersion(id) {
  const [row] = await db()`
    SELECT updated_at FROM sounds
     WHERE id = ${id} AND source = 'uploaded' AND audio_b64 IS NOT NULL LIMIT 1`;
  return row ? soundVersion(row.updated_at) : null;
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
  listSounds, listSoundIds, getSoundVersion, getSoundAudio,
  createSound, updateSound, deleteSound, reorderSounds,
};
