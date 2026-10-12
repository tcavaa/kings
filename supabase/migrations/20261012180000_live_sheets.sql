-- ─────────────────────────────────────────────────────────────────────────────
-- Score sheets being filled in right now on ჩაწერა, so others can follow a
-- table game live (King Online's homepage and ჩაწერა's home list them). A row
-- is written as rounds are entered and removed when the game is saved or
-- reset; rows idle for hours are ignored. Read and written only through the
-- app's API (the postgres role), like the other King Online tables.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.live_sheets (
  id         varchar(64) primary key,
  state      text        not null,
  updated_at timestamptz not null default now()
);

create index if not exists idx_live_sheets_updated on public.live_sheets (updated_at);

alter table public.live_sheets enable row level security;
revoke all on table public.live_sheets from anon, authenticated;
