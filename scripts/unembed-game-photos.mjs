// King Online games saved before 12 Oct 2026 carry every player's photo
// inside the game's payload as a base64 data URL (~60 KB a game, 17 MB in
// all). Every cold API instance had to scan that text to strip the photos
// out (server/db/games.js), which is what made the leaderboard slow to load.
// Games saved since then store a link to the player's profile photo
// (/api/profiles/<id>/avatar?v=<version>). This rewrites the old games the
// same way: each embedded photo becomes the link to that player's current
// profile photo, matched by name, or null when they have no profile or photo.
//
//   npm run db:unembed-game-photos               dry run: what would change
//   npm run db:unembed-game-photos -- --apply    rewrite the games
//
// Before writing, every original payload goes to
// scripts/.media-backup/games-<time>.json (git-ignored) so a row can be put
// back. A row is only written if nobody changed it since it was read.

import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const postgres = require('postgres');

const apply = process.argv.includes('--apply');
let url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
url = url.replace(/(\.pooler\.supabase\.com):6543\//, '$1:5432/');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || !url.includes('@');
const sql = postgres(url, { prepare: false, ssl: isLocal ? false : 'require', max: 1, onnotice: () => {} });

const kb = (n) => `${Math.round(n / 1024)} KB`;

// The link the API serves a profile's photo at (server/db/profiles.js).
const profiles = await sql`
  SELECT id, name, CASE WHEN avatar IS NULL THEN NULL ELSE left(md5(avatar), 12) END AS v FROM profiles`;
const linkByName = new Map();
for (const p of profiles) {
  linkByName.set(p.name.toLowerCase(), p.v ? `/api/profiles/${encodeURIComponent(p.id)}/avatar?v=${p.v}` : null);
}
const linkOf = (name) => linkByName.get(String(name || '').toLowerCase()) ?? null;

/** The payload with every embedded photo swapped for a link; counts what changed. */
function unembed(value, tally) {
  if (Array.isArray(value)) return value.map((v) => unembed(v, tally));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === 'avatar' && typeof v === 'string' && v.startsWith('data:')) {
      const link = linkOf(value.name);
      tally[link ? 'linked' : 'dropped']++;
      out[k] = link;
    } else {
      out[k] = unembed(v, tally);
    }
  }
  return out;
}

const rows = await sql`
  SELECT id, payload FROM finished_games WHERE payload LIKE '%"avatar":"data:%' ORDER BY played_at`;
const tally = { linked: 0, dropped: 0 };
let before = 0, after = 0;
const changes = rows.map((r) => {
  const next = JSON.stringify(unembed(JSON.parse(r.payload), tally));
  before += r.payload.length;
  after += next.length;
  return { id: r.id, old: r.payload, next };
});

console.log(`${rows.length} games embed photos: ${kb(before)} → ${kb(after)}`);
console.log(`photos → profile links: ${tally.linked}, → none (no profile or photo): ${tally.dropped}`);

if (!apply) {
  console.log('dry run — nothing written. Run with --apply to rewrite the games.');
} else if (changes.length) {
  const dir = join(import.meta.dirname, '.media-backup');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `games-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(changes.map(({ id, old }) => ({ id, payload: old }))));
  console.log(`originals saved to ${file}`);
  let written = 0;
  await sql.begin(async (tx) => {
    for (const c of changes) {
      const res = await tx`UPDATE finished_games SET payload = ${c.next} WHERE id = ${c.id} AND payload = ${c.old}`;
      written += res.count;
    }
  });
  console.log(`rewrote ${written} of ${changes.length} games${written < changes.length ? ' (the rest changed meanwhile — run again)' : ''}`);
}

await sql.end();
