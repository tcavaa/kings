#!/usr/bin/env node
// One-off: moves ჩაწერა's games into the shared games table.
//
//   npm run db:merge-score-app                   import (safe to re-run)
//   npm run db:merge-score-app -- --verify-only  only compare
//   npm run db:merge-score-app -- --retire-legacy
//        afterwards: move players / game_results / game_details into the
//        `legacy` schema, out of reach of the public API key
//
// Every game_results row (+ its game_details row) becomes a finished_games row
// with type 'live' (same id), in King Online's payload shape. Players linked
// to a King Online profile through players.online_name are stored under that
// profile (its name and id); the rest keep their name. Season champions are
// renamed the same way. Players without an online name are not carried over:
// ჩაწერა's player list is now `profiles`. Then every imported game is read
// back and turned into ჩაწერა's old rows again, which must equal the
// originals (names switched to online names, player ids to profile ids).
//
// Needs DATABASE_URL (the postgres role; a :6543 pooler URL is switched to :5432).

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const postgres = require('postgres');
const { fromLegacyRows } = require('../server/games/scoreSheet.js');
const { liveGameToLegacy } = await import('../src/score/lib/gameShapes.js');

const args = new Set(process.argv.slice(2));
let url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
// One long transaction: hangs on Supabase's transaction pooler (:6543), so use
// the session pooler (:5432) on the same host.
url = url.replace(/(\.pooler\.supabase\.com):6543\//, '$1:5432/');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || !url.includes('@');
const sql = postgres(url, { prepare: false, ssl: isLocal ? false : 'require', max: 1, onnotice: () => {} });

const SEP = ' & ';
const schemaOf = async (table) => (await sql`
  SELECT table_schema FROM information_schema.tables
   WHERE table_name = ${table} AND table_schema IN ('public', 'legacy')`)[0]?.table_schema;

try {
  const from = await schemaOf('game_results');
  if (!from) throw new Error('No game_results table found (public or legacy).');
  const t = (name) => sql(`${from}.${name}`);
  // Timestamps as text with their microseconds, so they are stored exactly.
  const ts = (col) => sql`to_char(${sql(col)} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"+00:00"')`;
  const [players, profiles, results, details, seasons] = await Promise.all([
    sql`SELECT id, name, online_name FROM ${t('players')}`,
    sql`SELECT id, name FROM profiles`,
    sql`SELECT id, ${ts('played_at')} AS played_at, winner_name, participants FROM ${t('game_results')} ORDER BY played_at`,
    sql`SELECT id, game_result_id, ${ts('played_at')} AS played_at, players, rounds FROM ${t('game_details')}`,
    sql`SELECT id, champion_name FROM seasons`,
  ]);

  // ჩაწერა name → King Online profile
  const profileByName = new Map(profiles.map((p) => [p.name, p]));
  const linked = new Map();
  for (const p of players) {
    if (!p.online_name) continue;
    const profile = profileByName.get(p.online_name);
    if (!profile) throw new Error(`Player "${p.name}" points at online name "${p.online_name}", which no profile has.`);
    linked.set(p.name, profile);
  }
  const profileOf = (name) => linked.get(name) || null;
  const detailOf = new Map(details.map((d) => [d.game_result_id, d]));
  // The same game saved twice (same moment, players and rounds) is imported once.
  const firstOf = new Map();
  const duplicates = [];
  for (const r of results) {
    const d = detailOf.get(r.id);
    const key = JSON.stringify([r.played_at, r.winner_name, r.participants, d ? [d.players.map((p) => p.name), d.rounds] : null]);
    if (firstOf.has(key)) duplicates.push({ id: r.id, of: firstOf.get(key), played_at: r.played_at });
    else firstOf.set(key, r.id);
  }
  const dupIds = new Set(duplicates.map((x) => x.id));
  const games = results.filter((r) => !dupIds.has(r.id));
  for (const x of duplicates) console.log(`duplicate save skipped: ${x.id} (= ${x.of}, ${x.played_at})`);
  const rows = games.map((r) => fromLegacyRows(r, detailOf.get(r.id) || null, profileOf));

  if (!args.has('--verify-only')) {
    const champion = (value) => value && value.split(SEP).map((n) => profileOf(n)?.name ?? n).join(SEP);
    const renamed = seasons.filter((s) => s.champion_name && champion(s.champion_name) !== s.champion_name);
    const inserted = await sql.begin(async (tx) => {
      let n = 0;
      for (const row of rows) {
        const res = await tx`
          INSERT INTO finished_games
            (id, type, played_at, winner_name, winner_seat, winner_score, is_championship, payload)
          VALUES (${row.id}, 'live', ${row.playedAt}::timestamptz, ${String(row.winner.name).slice(0, 64)},
                  ${row.winner.seat}, ${row.winner.score}, ${row.isChampionship}, ${JSON.stringify(row.payload)})
          ON CONFLICT (id) DO NOTHING`;
        n += res.count;
      }
      for (const s of renamed) {
        await tx`UPDATE seasons SET champion_name = ${champion(s.champion_name)} WHERE id = ${s.id}`;
      }
      return n;
    });
    console.log(`imported ${inserted} games (${rows.length - inserted} were already there); renamed ${renamed.length} season champions`);
    const dropped = players.filter((p) => !p.online_name).map((p) => p.name);
    console.log(`players carried over: ${linked.size} (as their profiles); not carried over (no online name): ${dropped.join(', ') || 'none'}`);
  }

  // ── read every game back the way the API serves it, and compare ──
  const stored = new Map((await sql`
    SELECT id, type, played_at, payload FROM finished_games WHERE id = ANY(${results.map((r) => r.id)})`)
    .map((r) => [r.id, r]));
  const online = (name) => profileOf(name)?.name ?? name;
  const ms = (v) => new Date(v).getTime();
  let checked = 0;
  for (const x of duplicates) assert.ok(!stored.has(x.id), `duplicate ${x.id} should not be imported`);
  for (const r of games) {
    const row = stored.get(r.id);
    assert.ok(row, `game ${r.id} is missing`);
    assert.equal(row.type, 'live', `game ${r.id} type`);
    const payload = JSON.parse(row.payload);
    const game = {
      id: row.id, type: row.type, playedAt: row.played_at.toISOString(),
      winners: payload.winners, players: payload.players, roundDetails: payload.roundDetails,
      ...(payload.durationSeconds != null && { durationSeconds: payload.durationSeconds }),
      ...(payload.legacy && { legacy: payload.legacy }),
    };
    const back = liveGameToLegacy(game);
    assert.equal(ms(back.result.played_at), ms(r.played_at), `played_at ${r.id}`);
    assert.equal(back.result.winner_name, r.winner_name.split(SEP).map(online).join(SEP), `winner ${r.id}`);
    assert.deepEqual(back.result.participants, r.participants.map((p) => ({ name: online(p.name), score: p.score })), `participants ${r.id}`);
    const d = detailOf.get(r.id);
    if (!d) { assert.equal(back.detail, null, `detail ${r.id}`); checked++; continue; }
    assert.equal(ms(back.detail.played_at), ms(d.played_at), `detail played_at ${r.id}`);
    // Columns line up with the result row (the result's names win, see fromLegacyRows).
    const idOf = new Map(d.players.map((p, i) => {
      const name = r.participants.some((x) => x.name === p.name) ? p.name : r.participants[i].name;
      return [p.id, profileOf(name)?.id ?? `guest:${name}`];
    }));
    const swap = (o) => (o == null ? null : Object.fromEntries(Object.entries(o).map(([k, v]) => [idOf.get(k), v])));
    assert.deepEqual(back.detail.players.map((p) => p.id), d.players.map((p) => idOf.get(p.id)), `players ${r.id}`);
    assert.deepEqual(back.detail.rounds, d.rounds.map((x) => ({
      scores: swap(x.scores), gameTypeCode: x.gameTypeCode, leaderPlayerId: idOf.get(x.leaderPlayerId) ?? null,
      countsByPlayerId: swap(x.countsByPlayerId),
      singleTargetPlayerId: x.singleTargetPlayerId == null ? null : idOf.get(x.singleTargetPlayerId),
    })), `rounds ${r.id}`);
    checked++;
  }
  console.log(`verified: all ${checked} ჩაწერა games read back exactly as ჩაწერა stored them`);

  if (args.has('--retire-legacy') && from === 'public') {
    await sql.begin(async (tx) => {
      await tx`CREATE SCHEMA IF NOT EXISTS legacy`;
      await tx`REVOKE ALL ON SCHEMA legacy FROM anon, authenticated`;
      for (const name of ['players', 'game_results', 'game_details']) {
        await tx.unsafe(`ALTER TABLE public.${name} SET SCHEMA legacy`);
      }
    });
    console.log('moved players, game_results, game_details into the legacy schema');
  }
} catch (err) {
  console.error(err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
