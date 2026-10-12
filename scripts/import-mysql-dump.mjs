#!/usr/bin/env node
// Import King Online's data from the cPanel phpMyAdmin dump (MySQL/MariaDB)
// into the Supabase Postgres database, then read every row back and compare
// it column by column with the dump.
//
//   node --env-file-if-exists=.env.local scripts/import-mysql-dump.mjs <dump.sql> [--replace] [--verify-only]
//
//   --replace       empty the four King Online tables first (one transaction —
//                   either the whole import lands or nothing changes)
//   --verify-only   don't write; just compare the database with the dump
//   --source-offset=+04:00
//                   UTC offset of the MySQL DATETIME values (default +04:00:
//                   the cPanel box ran on Tbilisi time — the epoch timestamps
//                   baked into the game/profile ids confirm it)
//
// Touches ONLY profiles, finished_games, live_games and sounds. The score
// app's tables (players, game_results, game_details, seasons) are never read
// or written. durak_live_games is skipped: ჩეხური დურაკა isn't part of the
// combined app.

import fs from 'node:fs';
import postgres from 'postgres';

const TABLES = {
  profiles: {
    columns: ['id', 'name', 'avatar', 'device_key', 'pin_hash', 'created_at', 'updated_at'],
    datetime: ['created_at', 'updated_at'],
    integer: [],
    key: 'id',
  },
  finished_games: {
    columns: ['id', 'played_at', 'winner_name', 'winner_seat', 'winner_score', 'is_championship', 'payload'],
    datetime: ['played_at'],
    integer: ['winner_seat', 'winner_score', 'is_championship'],
    key: 'id',
  },
  live_games: {
    columns: ['room_code', 'state_json', 'updated_at'],
    datetime: ['updated_at'],
    integer: [],
    key: 'room_code',
  },
  sounds: {
    columns: ['id', 'label', 'glyph', 'color', 'source', 'mime', 'audio_b64', 'sort_order', 'created_at', 'updated_at'],
    datetime: ['created_at', 'updated_at'],
    integer: ['sort_order'],
    key: 'id',
  },
};
const SKIPPED = new Set(['durak_live_games']);

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dumpPath = args.find((a) => !a.startsWith('--'));
const REPLACE = args.includes('--replace');
const VERIFY_ONLY = args.includes('--verify-only');
const OFFSET = (args.find((a) => a.startsWith('--source-offset=')) || '--source-offset=+04:00').split('=')[1];

if (!dumpPath) {
  console.error('usage: import-mysql-dump.mjs <dump.sql> [--replace] [--verify-only] [--source-offset=+04:00]');
  process.exit(2);
}
if (!/^[+-]\d{2}:\d{2}$/.test(OFFSET)) {
  console.error(`bad --source-offset ${OFFSET} (expected e.g. +04:00)`);
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (put it in .env.local or the environment).');
  process.exit(2);
}

// ── MySQL dump parser ───────────────────────────────────────────────────────
// Reads `INSERT INTO \`t\` (\`a\`, ...) VALUES (...), (...);` statements as
// written by phpMyAdmin / mysqldump. String literals follow MySQL's rules:
// backslash escapes \0 \' \" \b \n \r \t \Z \\, keep \% and \_ verbatim, drop
// the backslash before anything else, and '' is a quote.
const ESCAPES = { '0': '\0', "'": "'", '"': '"', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a', '\\': '\\' };

function readString(src, i) {
  // src[i] === "'"
  let out = '';
  let j = i + 1;
  let chunkStart = j;
  for (;;) {
    const c = src[j];
    if (c === undefined) throw new Error(`unterminated string at ${i}`);
    if (c === '\\') {
      out += src.slice(chunkStart, j);
      const n = src[j + 1];
      if (n === '%' || n === '_') out += '\\' + n;
      else out += n in ESCAPES ? ESCAPES[n] : n;
      j += 2;
      chunkStart = j;
      continue;
    }
    if (c === "'") {
      if (src[j + 1] === "'") {
        out += src.slice(chunkStart, j) + "'";
        j += 2;
        chunkStart = j;
        continue;
      }
      out += src.slice(chunkStart, j);
      return [out, j + 1];
    }
    j++;
  }
}

function skipWs(src, i) {
  while (i < src.length && (src[i] === ' ' || src[i] === '\n' || src[i] === '\r' || src[i] === '\t')) i++;
  return i;
}

function parseDump(src) {
  const out = {};
  const head = /INSERT INTO `(\w+)` \(([^)]*)\) VALUES\s*/g;
  let m;
  while ((m = head.exec(src))) {
    const table = m[1];
    const columns = m[2].split(',').map((s) => s.trim().replace(/^`|`$/g, ''));
    let i = head.lastIndex;
    const rows = (out[table] ||= { columns, rows: [] }).rows;
    if (out[table].columns.join() !== columns.join()) throw new Error(`column list changed for ${table}`);
    for (;;) {
      i = skipWs(src, i);
      if (src[i] !== '(') throw new Error(`expected ( at ${i} in ${table}`);
      i++;
      const values = [];
      for (;;) {
        i = skipWs(src, i);
        let v;
        if (src[i] === "'") {
          [v, i] = readString(src, i);
        } else if (src.startsWith('NULL', i)) {
          v = null;
          i += 4;
        } else {
          const num = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(src.slice(i, i + 64));
          if (!num) throw new Error(`unexpected value at ${i} in ${table}: ${src.slice(i, i + 30)}`);
          v = num[0];
          i += num[0].length;
        }
        values.push(v);
        i = skipWs(src, i);
        if (src[i] === ',') { i++; continue; }
        if (src[i] === ')') { i++; break; }
        throw new Error(`expected , or ) at ${i} in ${table}`);
      }
      if (values.length !== columns.length) throw new Error(`row width mismatch in ${table}`);
      rows.push(Object.fromEntries(columns.map((c, k) => [c, values[k]])));
      i = skipWs(src, i);
      if (src[i] === ',') { i++; continue; }
      if (src[i] === ';') { i++; break; }
      throw new Error(`expected , or ; at ${i} in ${table}`);
    }
    head.lastIndex = i;
  }
  return out;
}

// ── value conversion ────────────────────────────────────────────────────────
function toInstant(datetime) {
  // 'YYYY-MM-DD HH:MM:SS' wall time at OFFSET → Date
  if (datetime === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(datetime);
  if (!m) throw new Error(`unexpected DATETIME ${datetime}`);
  const d = new Date(`${m[1]}T${m[2]}${OFFSET}`);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid DATETIME ${datetime}`);
  return d;
}

function convertRow(table, row) {
  const spec = TABLES[table];
  const out = {};
  for (const c of spec.columns) {
    let v = row[c];
    if (v === undefined) throw new Error(`${table}: dump has no column ${c}`);
    if (spec.datetime.includes(c)) v = toInstant(v);
    else if (spec.integer.includes(c)) v = v === null ? null : Number(v);
    out[c] = v;
  }
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────
const src = fs.readFileSync(dumpPath, 'utf8');
const parsed = parseDump(src);

const plan = {};
for (const [table, { rows }] of Object.entries(parsed)) {
  if (SKIPPED.has(table)) { console.log(`skip  ${table} (${rows.length} rows — not part of the combined app)`); continue; }
  if (!TABLES[table]) throw new Error(`dump contains unknown table ${table}`);
  plan[table] = rows.map((r) => convertRow(table, r));
}
for (const table of Object.keys(TABLES)) plan[table] ||= [];

console.log('dump:', Object.entries(plan).map(([t, r]) => `${t}=${r.length}`).join('  '));

const url = new URL(process.env.DATABASE_URL);
const isLocal = ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
const sql = postgres(process.env.DATABASE_URL, {
  prepare: false, ssl: isLocal ? false : 'require', max: 1, onnotice: () => {},
});
console.log(`target: ${url.hostname}${url.pathname}`);

try {
  if (!VERIFY_ONLY) {
    await sql.begin(async (tx) => {
      const counts = {};
      for (const table of Object.keys(TABLES)) {
        const [{ n }] = await tx`SELECT count(*)::int AS n FROM ${tx(table)}`;
        counts[table] = n;
      }
      const nonEmpty = Object.entries(counts).filter(([, n]) => n > 0);
      if (nonEmpty.length && !REPLACE) {
        throw new Error(
          `target tables are not empty (${nonEmpty.map(([t, n]) => `${t}=${n}`).join(', ')}). ` +
          'Re-run with --replace to overwrite them.'
        );
      }
      if (REPLACE) {
        await tx`TRUNCATE profiles, finished_games, live_games, sounds`;
      }
      for (const [table, rows] of Object.entries(plan)) {
        const { columns } = TABLES[table];
        // ~1 MB per statement keeps every round-trip comfortably small.
        let batch = [];
        let bytes = 0;
        const flush = async () => {
          if (!batch.length) return;
          await tx`INSERT INTO ${tx(table)} ${tx(batch, columns)}`;
          batch = [];
          bytes = 0;
        };
        for (const row of rows) {
          batch.push(row);
          bytes += JSON.stringify(row).length;
          if (bytes > 1_000_000) await flush();
        }
        await flush();
        console.log(`wrote ${table}: ${rows.length}`);
      }
    });
  }

  // ── verify: every row, every column ───────────────────────────────────────
  let problems = 0;
  for (const [table, rows] of Object.entries(plan)) {
    const { columns, datetime, key } = TABLES[table];
    const dbRows = await sql`SELECT ${sql(columns)} FROM ${sql(table)}`;
    const byKey = new Map(dbRows.map((r) => [r[key], r]));
    if (dbRows.length !== rows.length) {
      problems++;
      console.error(`MISMATCH ${table}: dump has ${rows.length} rows, database has ${dbRows.length}`);
    }
    for (const want of rows) {
      const got = byKey.get(want[key]);
      if (!got) { problems++; console.error(`MISSING ${table} ${want[key]}`); continue; }
      for (const c of columns) {
        const a = want[c];
        const b = got[c];
        const same = datetime.includes(c)
          ? (a === null ? b === null : b instanceof Date && a.getTime() === b.getTime())
          : a === b;
        if (!same) {
          problems++;
          const show = (x) => (x instanceof Date ? x.toISOString() : JSON.stringify(x)?.slice(0, 80));
          console.error(`DIFF ${table} ${want[key]}.${c}: dump=${show(a)} db=${show(b)}`);
        }
      }
    }
    console.log(`verified ${table}: ${rows.length} rows`);
  }
  if (problems) {
    console.error(`\n${problems} problem(s) found.`);
    process.exitCode = 1;
  } else {
    console.log('\nAll rows match the dump exactly.');
  }
} finally {
  await sql.end();
}
