-- ─────────────────────────────────────────────────────────────────────────
-- King Online tables, moved from the cPanel MySQL database (`rretroca_king`)
-- into the shared KING-APP database. Same tables, columns and keys as the
-- MySQL schema, translated to Postgres:
--   DATETIME            → timestamptz (the import converts Tbilisi wall time)
--   MEDIUMTEXT/LONGTEXT → text
--   TINYINT             → smallint (is_championship keeps its 0/1 values)
--
-- Only the game server and the Next.js API read or write these, connecting
-- through DATABASE_URL as the `postgres` role (which bypasses RLS). RLS is on
-- with no policies, and the client roles' grants are revoked, so the public
-- anon key the score app ships can never read profiles' PIN hashes.
--
-- The score app's own tables (players, game_results, game_details, seasons)
-- are untouched.
-- ─────────────────────────────────────────────────────────────────────────

-- ─── profiles ────────────────────────────────────────────────────────────
-- One row per saved player profile (created from the lobby).
create table if not exists public.profiles (
  id          varchar(64)  primary key,
  name        varchar(64)  not null,
  avatar      text,                          -- base64 data URL of a thumbnail
  device_key  varchar(128),                  -- ownership token (the browser that created it)
  pin_hash    varchar(128),                  -- sha256(id + ':' + pin) — never returned to clients
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);
create index if not exists idx_profiles_name on public.profiles (name);

-- ─── finished_games ──────────────────────────────────────────────────────
-- One row per finished game. The full per-round detail is kept as JSON text
-- so the leaderboard can render the tally trail and round breakdown.
-- is_championship: championship games count toward the daily per-player
-- quota and are the only online games the score app's seasons count.
create table if not exists public.finished_games (
  id               varchar(64)  primary key,
  played_at        timestamptz  not null default now(),
  winner_name      varchar(64)  not null,
  winner_seat      smallint     not null,
  winner_score     integer      not null,
  is_championship  smallint     not null default 1,
  payload          text         not null,   -- {players, roundDetails, winners, isTie}
  constraint uq_winner_played unique (winner_name, winner_score, played_at)
);
create index if not exists idx_finished_played_at on public.finished_games (played_at);
create index if not exists idx_finished_championship on public.finished_games (is_championship, played_at);

-- ─── live_games ──────────────────────────────────────────────────────────
-- Snapshot of every in-flight room, rewritten after every state-changing
-- action so a game-server restart (or Render waking up) resumes mid-game.
-- Removed when the game ends or the last player leaves.
create table if not exists public.live_games (
  room_code   varchar(6)   primary key,
  state_json  text         not null,
  updated_at  timestamptz  not null default now()
);
create index if not exists idx_live_updated on public.live_games (updated_at);

-- ─── sounds ──────────────────────────────────────────────────────────────
-- The reaction-clip catalogue behind the in-game sound buttons (/admin).
--   source 'builtin'  → file ships in /public/sounds/<id>.mp3, audio_b64 null
--   source 'uploaded' → bytes in audio_b64, served by /api/sounds/:id/audio
create table if not exists public.sounds (
  id          varchar(64)  primary key,      -- also the play-sound wire id
  label       varchar(64)  not null,         -- name shown on the button
  glyph       varchar(8)   not null default '?',
  color       varchar(16)  not null default '#8e6a1e',
  source      varchar(16)  not null default 'uploaded',
  mime        varchar(64),
  audio_b64   text,                          -- base64, no data: prefix
  sort_order  integer      not null default 0,
  created_at  timestamptz  not null default now(),
  updated_at  timestamptz  not null default now()
);
create index if not exists idx_sounds_order on public.sounds (sort_order, id);

-- ─── updated_at ──────────────────────────────────────────────────────────
-- MySQL's `ON UPDATE CURRENT_TIMESTAMP`: bump updated_at only when a column
-- really changes, and never when the statement assigned updated_at itself.
-- sounds.sort_order is deliberately not tracked: the reorder path set
-- `updated_at = updated_at` in MySQL so the `?v=` cache-buster in every clip
-- url survives a drag-and-drop reorder.
create or replace function public.king_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row
  when (
    (old.id, old.name, old.avatar, old.device_key, old.pin_hash, old.created_at)
      is distinct from
    (new.id, new.name, new.avatar, new.device_key, new.pin_hash, new.created_at)
    and old.updated_at is not distinct from new.updated_at
  )
  execute function public.king_touch_updated_at();

drop trigger if exists live_games_touch_updated_at on public.live_games;
create trigger live_games_touch_updated_at
  before update on public.live_games
  for each row
  when (
    (old.room_code, old.state_json) is distinct from (new.room_code, new.state_json)
    and old.updated_at is not distinct from new.updated_at
  )
  execute function public.king_touch_updated_at();

drop trigger if exists sounds_touch_updated_at on public.sounds;
create trigger sounds_touch_updated_at
  before update on public.sounds
  for each row
  when (
    (old.id, old.label, old.glyph, old.color, old.source, old.mime, old.audio_b64, old.created_at)
      is distinct from
    (new.id, new.label, new.glyph, new.color, new.source, new.mime, new.audio_b64, new.created_at)
    and old.updated_at is not distinct from new.updated_at
  )
  execute function public.king_touch_updated_at();

-- ─── access ──────────────────────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.finished_games enable row level security;
alter table public.live_games     enable row level security;
alter table public.sounds         enable row level security;

revoke all on table public.profiles, public.finished_games, public.live_games, public.sounds
  from anon, authenticated;
revoke all on function public.king_touch_updated_at() from public, anon, authenticated;
