// Shrink the media already stored in the database, the way new uploads are
// shrunk in the browser now:
//   profile photos   → 256px WebP, quality 80 (src/online/lib/profiles.js)
//   uploaded sounds  → 64 kbps mono MP3       (src/online/lib/compressAudio.js)
// Built-in sounds are files in public/sounds and are re-encoded there.
//
//   npm run db:optimize-media                      dry run: what would change
//   npm run db:optimize-media -- --apply           write the smaller versions
//
// Before writing, every original goes to scripts/.media-backup/<time>.json
// (git-ignored) so a row can be put back. A row is only replaced when the
// new version is smaller. Needs DATABASE_URL, and cwebp and ffmpeg on PATH.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const postgres = require('postgres');

const apply = process.argv.includes('--apply');
let url = process.env.DATABASE_URL;
if (!url) { console.error('DATABASE_URL is not set'); process.exit(1); }
url = url.replace(/(\.pooler\.supabase\.com):6543\//, '$1:5432/');
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || !url.includes('@');
const sql = postgres(url, { prepare: false, ssl: isLocal ? false : 'require', max: 1, onnotice: () => {} });

const work = mkdtempSync(join(tmpdir(), 'king-media-'));
const kb = (n) => `${Math.round(n / 1024)} KB`;
const run = (cmd, args) => execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });

/** A data URL's bytes and type, or null. */
function fromDataUrl(dataUrl) {
  const m = /^data:([a-z0-9/+.-]+);base64,(.+)$/i.exec(dataUrl || '');
  return m ? { mime: m[1].toLowerCase(), bytes: Buffer.from(m[2], 'base64') } : null;
}

function toWebp(bytes) {
  const src = join(work, 'in.img'), out = join(work, 'out.webp');
  writeFileSync(src, bytes);
  // At most 256px on a side, the size uploads are cut to (0 keeps the ratio).
  const size = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', src]))
    .streams?.[0];
  const resize = size && Math.max(size.width, size.height) > 256
    ? ['-resize', ...(size.width >= size.height ? ['256', '0'] : ['0', '256'])]
    : [];
  run('cwebp', ['-quiet', '-q', '80', '-m', '6', ...resize, src, '-o', out]);
  return readFileSync(out);
}

function toMp3(bytes) {
  const src = join(work, 'in.audio'), out = join(work, 'out.mp3');
  writeFileSync(src, bytes);
  run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-map', '0:a:0', '-map_metadata', '-1', '-ac', '1', '-ar', '44100',
    '-c:a', 'libmp3lame', '-b:a', '64k', '-id3v2_version', '0', '-write_id3v1', '0', out]);
  return readFileSync(out);
}

const backup = { profiles: [], sounds: [] };
const changes = [];
let before = 0, after = 0;

for (const p of await sql`SELECT id, name, avatar FROM profiles WHERE avatar IS NOT NULL ORDER BY name`) {
  const img = fromDataUrl(p.avatar);
  if (!img) { console.log(`photo  ${p.name}: not a data URL, skipped`); continue; }
  const small = toWebp(img.bytes);
  const keep = small.length >= img.bytes.length;
  console.log(`photo  ${p.name}: ${img.mime} ${kb(img.bytes.length)} → webp ${kb(small.length)}${keep ? ' (kept, not smaller)' : ''}`);
  if (keep) continue;
  before += img.bytes.length; after += small.length;
  backup.profiles.push({ id: p.id, avatar: p.avatar });
  changes.push((tx) => tx`UPDATE profiles SET avatar = ${`data:image/webp;base64,${small.toString('base64')}`} WHERE id = ${p.id}`);
}

for (const s of await sql`SELECT id, label, mime, audio_b64 FROM sounds WHERE source = 'uploaded' AND audio_b64 IS NOT NULL ORDER BY sort_order`) {
  const bytes = Buffer.from(s.audio_b64, 'base64');
  const small = toMp3(bytes);
  const keep = small.length >= bytes.length;
  console.log(`sound  ${s.label}: ${s.mime} ${kb(bytes.length)} → mp3 ${kb(small.length)}${keep ? ' (kept, not smaller)' : ''}`);
  if (keep) continue;
  before += bytes.length; after += small.length;
  backup.sounds.push({ id: s.id, mime: s.mime, audio_b64: s.audio_b64 });
  // A new updated_at gives the clip a new ?v=, so browsers fetch the new file.
  changes.push((tx) => tx`UPDATE sounds SET mime = 'audio/mpeg', audio_b64 = ${small.toString('base64')}, updated_at = now() WHERE id = ${s.id}`);
}

console.log(`\n${changes.length} to replace: ${kb(before)} → ${kb(after)}`);
if (!apply) {
  console.log('Dry run. Add --apply to write them.');
} else if (changes.length) {
  const dir = new URL('./.media-backup/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(file, JSON.stringify(backup));
  console.log(`Originals saved to ${file}`);
  await sql.begin(async (tx) => {
    for (const change of changes) await change(tx);
  });
  console.log('Written.');
}
rmSync(work, { recursive: true, force: true });
await sql.end();
