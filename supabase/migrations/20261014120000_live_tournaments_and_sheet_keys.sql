-- ─────────────────────────────────────────────────────────────────────────────
-- live_tournaments  A snapshot of every King Online tournament that hasn't
--                   finished (lobby, draw, recorded table results, final),
--                   rewritten as it changes, so a game-server restart picks
--                   the bracket up together with its tables (live_games).
--                   Removed when the tournament ends.
-- live_sheets.key_hash
--                   sha256 of the write key the device keeping a ჩაწერა
--                   sheet made up. Only writes with that key may change or
--                   remove the sheet; the key itself is never stored.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.live_tournaments (
  id          varchar(16)  primary key,
  state_json  text         not null,
  updated_at  timestamptz  not null default now()
);

drop trigger if exists live_tournaments_touch_updated_at on public.live_tournaments;
create trigger live_tournaments_touch_updated_at
  before update on public.live_tournaments
  for each row
  when (
    (old.id, old.state_json) is distinct from (new.id, new.state_json)
    and old.updated_at is not distinct from new.updated_at
  )
  execute function public.king_touch_updated_at();

alter table public.live_tournaments enable row level security;
revoke all on table public.live_tournaments from anon, authenticated;

alter table public.live_sheets add column if not exists key_hash char(64);
