# Kings

**King Online** (live three-player King card game) and **King Score** (the
score keeper for games played at a real table) in one project, on one
database.

- `/` — King Online: lobby, quick-match tables, private rooms, tournaments,
  leaderboard, spectating, chat/voice/sound reactions, `/admin` (sounds, seasons, players).
- `/score` — King Score: score sheet, history, seasons, stats, achievements.
  Opened from King Online's **ჩაწერა** button (main nav + the lobby tile); its
  header links back to King Online. Games being scored right now show under
  **Live now** on its home screen (anyone can follow one; `/score?live=<id>`).
- King Online's leaderboard has a **სეზონები** tab: the running season (facts,
  wins race, table) and every finished season's champion and table. Every
  King Online table is a league table (the casual კლასიკური mode is gone).
- One Supabase database (project `KINGS`, Frankfurt) for both, with **one
  player list** (`profiles`) and **one games table** (`finished_games`, each
  game `type` = `online` or `live` — played in King Online, or at a table and
  recorded in King Score). A player added in either app shows up in both, and
  both apps' leaderboards/stats count every game, with an
  All / Online / Live filter. King Online's old public API (`/api/public/*`) is gone.

Live: https://kingge.vercel.app (Vercel project `kings`, team
"Tsava") · game server https://kings-game-server.onrender.com (Render
service `kings-game-server`).

## Architecture

```
 browser ──► Vercel (Next.js 16)          ──► Supabase Postgres (KINGS)
             ├ /            King Online UI      ├ profiles, finished_games,
             ├ /score       King Score UI       │ live_games, sounds  (both apps, via /api)
             └ /api/*       REST API ───────────┘ seasons, live_sheets, profile_sessions
 browser ──► Render (Node, Socket.IO) ── game server ──► same Postgres
```

The live game needs one long-running process that holds every table in
memory (dealing, turn order, timers, reconnects). Serverless functions can't
do that, so the Socket.IO server runs on Render; everything else is on
Vercel. All three run on free plans.

| Piece | Host | Notes |
|---|---|---|
| Next.js app + REST API | Vercel (Hobby) | functions in `fra1` (Frankfurt), next to the database |
| Game server (`server/`) | Render (Free) | Frankfurt. Sleeps after 15 min with nobody connected; the first visitor after that waits ~1 min for it to wake. Live games are snapshotted to `live_games` and restored on wake. |
| Database | Supabase (Free) | project `KINGS`, `eu-central-1` (Frankfurt), next to the game server |

## Repo layout

```
app/                    Next.js App Router
  (online)/             King Online's root layout + catch-all page (old index.html)
  (score)/score/        King Score's root layout + page (old index.html)
  api/                  REST routes (were King Online's Express routes)
src/online/             King Online client (React + Phaser + Tailwind), unchanged
src/score/              King Score client (React + plain CSS), unchanged
shared/                 game logic both clients use (achievements, win probability, totals)
server/                 Socket.IO game server (Render) — game/socket/tournament
  game/gameTypes.js     the nine game types and their scoring — server and both clients
  games/results.js      winners, per-round stats, season tables — server and both clients
  db/                   Postgres store, shared with the Next.js API routes
lib/api/http.js         request/response plumbing for the API routes
supabase/migrations/    King Online schema for Postgres
supabase/seed.sql       built-in sound clips (fresh databases only)
render.yaml             Render blueprint for the game server
```

The two clients are mounted client-only (`next/dynamic`, `ssr: false`), each
under its own root layout, so they render exactly as their Vite builds did and
their stylesheets never meet (moving between them is a full page load).

Both clients use the same recharts 3 and lucide-react 1.25.

Game rules live once: code only the clients share is in `shared/`; code the
game server needs too sits under `server/` (Render deploys only that folder)
and the clients import it from there, like `server/game/rules.js`. Each app
keeps its own wording (King Online is Georgian, King Score English), icons
and look on top.

## Environment variables

**Vercel** (and `.env.local` for local dev — see `.env.example`):

| Var | Required | |
|---|---|---|
| `DATABASE_URL` | yes | Supabase → Connect → Transaction pooler URI (`:6543`) |
| `NEXT_PUBLIC_SOCKET_URL` | yes | the Render URL, e.g. `https://kings-game-server.onrender.com` |
| `ADMIN_PASSCODE` | yes | `/admin` passcode, 8+ characters; without it `/admin` stays locked |
| `DB_POOL_MAX` | no | connections per function instance (default 5; 3 is plenty) |
| `APP_TIMEZONE` | no | championship calendar day (default `Asia/Tbilisi`) |

`NEXT_PUBLIC_*` values are baked in at build time — redeploy after changing them.

**Render** (`server/.env` locally — see `server/.env.example`): `DATABASE_URL`,
`CORS_ORIGIN` (the Vercel URL, or `*`), `APP_TIMEZONE`.

## Local development

```bash
npm install && npm --prefix server install
cp .env.example .env.local            # fill in
cp server/.env.example server/.env    # fill in
npm run server:dev                    # game server on :3001
npm run dev                           # app on :3000
```

Tests: `npm test` (client unit test + tournament bracket). Socket-level
smoke tests boot the game server in-process: `npm --prefix server run smoke`,
and `node server/socket/fullgame.smoke.js` plays a complete seeded 27-round
game (bots) and checks it lands in the database.

## Database

**Players** — `profiles` is the one player list. King Online creates
profiles with a PIN and photo; King Score adds plain ones (`POST /api/players`)
and can only remove those (a profile with a PIN belongs to King Online).
Changing or deleting a profile that has a PIN needs that PIN (`currentPin`
in the request body; 403 otherwise), so the lobby asks for it before the
edit form opens.
Games refer to players by name (King Online always has), and King Score's
games also store the profile id.

**Games** — `finished_games` holds both apps' games in King Online's payload
shape; `type` tells them apart. A score-sheet game is converted by
`server/games/scoreSheet.js` (round scores per seat, the round's own card
counts as King Online's `*Taken` fields, plus the sheet's entry as typed),
and `src/score/lib/gameShapes.js` turns any game back into King Score's old
rows, so its screens work unchanged. The daily league limit counts online
games only.

King Score's old tables (`players`, `game_results`, `game_details`) were
imported with `npm run db:merge-score-app` (safe to re-run; it verifies every
game reads back exactly). Players without an online name were not carried
over — their old games keep their name, but they aren't listed or ranked.
Backups of the old tables are in `backups/` (gitignored); the tables themselves can be dropped once nobody needs them.

`supabase/migrations/20261012120000_king_online.sql` creates King Online's
tables — same tables, columns and keys as the MySQL schema (DATETIME →
timestamptz, MEDIUMTEXT → text). RLS is on with no policies and the client
roles' grants are revoked: only `DATABASE_URL` (the `postgres` role) can read
them, so PIN hashes never reach the public anon key. MySQL's
`ON UPDATE CURRENT_TIMESTAMP` is reproduced with triggers.
`20261013120000_lockdown.sql` does the same for `seasons` (which King Score
used to write from the browser) and adds `profile_sessions` and
`rate_limits`.

## Who may play as whom

- Picking a profile in the lobby (with its PIN, if it has one) gets a session
  token from `/api/profiles/:id/verify-pin`. The game server only lets a
  socket play under a PIN-protected name with that token, and takes the name
  and photo from the profile.
- Every browser also sends its own random key when its socket connects. A seat
  (or tournament entry) can only be taken back by the same browser or the same
  signed-in profile — a name alone is never enough.
- Wrong PINs and admin passcodes are counted in `rate_limits`: 8 PIN guesses
  per profile and 10 passcode guesses per IP per 15 minutes.
- Profile photos are served from `/api/profiles/:id/avatar?v=…` (cached for
  good), and only those links travel in sockets, snapshots and saved games.
- Seasons (name, theme, ending one) and the player list are managed in
  `/admin`; King Score only reads them.

King Online's data came from the cPanel MySQL dump through a one-off import
script (removed once the import was done; see git history).

The store keeps a per-process mirror of `finished_games` and `profiles`,
checked against row versions (`xmin`) before every read, so the multi-MB
avatar-laden game list crosses the network once per instance instead of once
per request (Supabase's free egress allowance is 5 GB/month). Results are
always identical to a fresh query.

## Deploy

1. **Supabase**: apply the migration, then import the dump (above).
2. **Render**: New → Blueprint → this repo. Set `DATABASE_URL` and
   `CORS_ORIGIN`. Note the service URL.
3. **Vercel**: import this repo (framework: Next.js). Set the env vars above
   (`NEXT_PUBLIC_SOCKET_URL` = the Render URL) and deploy.

## What changed compared with the two old apps

- Hosting: cPanel (Express + MySQL) and Netlify → Vercel + Render + Supabase.
  Same game logic: the engines are untouched, the MySQL store was ported to
  Postgres query by query, and seeded full games produce byte-identical
  results on the old and new servers.
- **Spin King** and **ჩეხური დურაკა** are removed (client, server, database).
  The lobby's mode tabs are now three (ლიგა · კლასიკური · ტურნირი).
- King Online has a **ჩაწერა** entry in its main nav and the lobby tile that
  used to open Durak; it opens the score app at `/score`.
- The score app's "More" tab has a link back to King Online (needed when it's
  installed as a home-screen app with no browser back button), and its
  manifest `start_url` is `/score`.
- Big game lists are streamed (Vercel's 4.5 MB limit only applies to buffered
  responses).
- Players and games are shared between the apps (see **Database**); King
  Score reads and writes them through `/api/players` and `/api/games` instead
  of Supabase directly. Seasons too, through `/api/seasons`.
