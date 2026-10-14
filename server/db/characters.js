'use strict';

// Each profile's look at the 3D table: male/female base body and an optional
// uploaded head model. Only the owner (PIN) may change it.

const { db } = require('./connection');
const { badRequest } = require('../lib/httpError');
const { assertPinOwner } = require('./profiles');

const GENDERS = new Set(['male', 'female']);

const headUrl = (id, v) => (v ? `/api/profiles/${encodeURIComponent(id)}/character/head?v=${v}` : null);
const toLook = (row) => ({ gender: row?.gender || 'male', head: row ? headUrl(row.profile_id, row.head_v) : null });

/** { gender, head: url|null } for one profile (defaults when never set). */
async function getCharacter(id) {
  const [row] = await db()`
    SELECT profile_id, gender, head_v FROM profile_characters WHERE profile_id = ${id}`;
  return toLook(row || { profile_id: id });
}

/** Looks for several profiles at once, keyed by id; unknown ids get defaults. */
async function getCharacters(ids) {
  const wanted = [...new Set(ids.filter((x) => typeof x === 'string' && x && x.length <= 64))].slice(0, 12);
  if (!wanted.length) return {};
  const rows = await db()`
    SELECT profile_id, gender, head_v FROM profile_characters WHERE profile_id = ANY(${wanted})`;
  const out = Object.fromEntries(wanted.map((id) => [id, toLook({ profile_id: id })]));
  for (const row of rows) out[row.profile_id] = toLook(row);
  return out;
}

/** The uploaded head as bytes, or null. */
async function getCharacterHead(id) {
  const [row] = await db()`
    SELECT head_glb, head_v FROM profile_characters WHERE profile_id = ${id} AND head_glb IS NOT NULL`;
  return row ? { buffer: Buffer.from(row.head_glb, 'base64'), version: row.head_v } : null;
}

/**
 * Owner-only update. `gender`: 'male' | 'female' | undefined (keep).
 * `head`: base64 GLB sets it, null removes it, undefined keeps it.
 */
async function saveCharacter({ id, gender, head, currentPin }) {
  if (gender !== undefined && !GENDERS.has(gender)) throw badRequest('gender must be male or female');
  return db().begin(async (tx) => {
    const [profile] = await tx`SELECT pin_hash FROM profiles WHERE id = ${id} FOR UPDATE`;
    if (!profile) return null;
    assertPinOwner(profile.pin_hash, currentPin, id);
    await tx`
      INSERT INTO profile_characters (profile_id) VALUES (${id})
      ON CONFLICT (profile_id) DO NOTHING`;
    const sets = { updated_at: new Date() };
    if (gender !== undefined) sets.gender = gender;
    if (head !== undefined) sets.head_glb = head;
    await tx`UPDATE profile_characters SET ${tx(sets)} WHERE profile_id = ${id}`;
    if (head !== undefined)
      await tx`UPDATE profile_characters SET head_v = left(md5(head_glb), 12) WHERE profile_id = ${id}`;
    const [row] = await tx`SELECT profile_id, gender, head_v FROM profile_characters WHERE profile_id = ${id}`;
    return toLook(row);
  });
}

module.exports = { getCharacter, getCharacters, getCharacterHead, saveCharacter };
