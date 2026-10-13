-- ─────────────────────────────────────────────────────────────────────────────
-- Everything goes through the app's API (the postgres role) now:
--
--   seasons           ჩაწერა used to read and write it from the browser with
--                     the public anon key (RLS was off). Seasons are managed
--                     from /admin through /api/seasons, so the client roles
--                     lose every grant.
--   profile_sessions  Proof that a browser picked a profile (and knew its PIN,
--                     if it has one). The game server checks the token before
--                     it lets a socket play under that profile's name. Only a
--                     sha256 of each token is stored.
--   rate_limits       Fixed-window counters for PIN and admin-passcode
--                     guesses. In the database because Vercel runs many
--                     short-lived instances that share no memory.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.seasons (
  id            uuid        primary key default gen_random_uuid(),
  name          text,
  theme         text,
  champion_name text,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz
);

create table if not exists public.profile_sessions (
  token_hash  char(64)     primary key,
  profile_id  varchar(64)  not null references public.profiles (id) on delete cascade,
  created_at  timestamptz  not null default now(),
  last_used_at timestamptz not null default now()
);
create index if not exists idx_profile_sessions_profile on public.profile_sessions (profile_id);

create table if not exists public.rate_limits (
  key           varchar(160) primary key,
  window_start  timestamptz  not null default now(),
  hits          integer      not null default 0
);

alter table public.seasons          enable row level security;
alter table public.profile_sessions enable row level security;
alter table public.rate_limits      enable row level security;

revoke all on table public.seasons, public.profile_sessions, public.rate_limits
  from anon, authenticated;
