'use strict';

// ─── live score sheets: ჩაწერა games in progress, for others to follow ──────
// The device keeping a sheet makes up a random write key and sends it with
// every write. The first write stores the key's sha256; after that only
// writes with the same key may change or remove the sheet. Sheet ids are
// listed publicly, so without this anyone could overwrite one others follow.

const crypto = require('crypto');
const { db } = require('./connection');
const { httpError, badRequest } = require('../lib/httpError');
const { ALL_TYPE_CODES: GAME_TYPE_CODES } = require('../game/constants');

const LIVE_SHEET_HOURS = 3;
const SHEET_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function keyHash(key) {
  if (typeof key !== 'string' || key.length < 16 || key.length > 128) {
    throw httpError(401, 'This sheet needs its write key.');
  }
  return crypto.createHash('sha256').update(key).digest('hex');
}

const notYours = () => httpError(403, 'This sheet is kept on another device.');

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
    surrenderedBy: ids.has(state.surrenderedBy) ? state.surrenderedBy : null,
  };
  const text = JSON.stringify(clean);
  if (text.length > 100 * 1024) throw badRequest('Score sheet is too large.');
  return text;
}

/**
 * Publish a sheet. A sheet nobody has written to for LIVE_SHEET_HOURS (no
 * longer listed anywhere), or one saved before write keys existed, goes to
 * whoever writes it next.
 */
async function saveLiveSheet(id, state, key) {
  if (!SHEET_ID_RE.test(String(id))) throw badRequest('Invalid sheet id.');
  const hash = keyHash(key);
  const text = sheetState(state);
  const rows = await db()`
    INSERT INTO live_sheets (id, state, key_hash, updated_at) VALUES (${id}, ${text}, ${hash}, now())
    ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, key_hash = EXCLUDED.key_hash, updated_at = now()
     WHERE live_sheets.key_hash = EXCLUDED.key_hash
        OR live_sheets.key_hash IS NULL
        OR live_sheets.updated_at < now() - make_interval(hours => ${LIVE_SHEET_HOURS})
    RETURNING id`;
  if (!rows.length) throw notYours();
}

async function deleteLiveSheet(id, key) {
  const hash = keyHash(key);
  const res = await db()`
    DELETE FROM live_sheets WHERE id = ${String(id)} AND (key_hash = ${hash} OR key_hash IS NULL)`;
  if (res.count) return;
  const [other] = await db()`SELECT 1 FROM live_sheets WHERE id = ${String(id)}`;
  if (other) throw notYours();
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

module.exports = { listLiveSheets, saveLiveSheet, deleteLiveSheet };
