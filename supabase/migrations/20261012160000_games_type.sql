-- ─────────────────────────────────────────────────────────────────────────────
-- One games table for both apps. finished_games already holds King Online's
-- games; games recorded in ჩაწერა (played at a real table) join them in the
-- same payload shape, told apart by `type`:
--   'online'  played in King Online
--   'live'    recorded on ჩაწერა's score sheet
-- profiles is the one player list for both apps. ჩაწერა's old tables
-- (players, game_results, game_details) are imported by
-- scripts/merge-score-app.mjs.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.finished_games
  add column if not exists type varchar(8) not null default 'online';

alter table public.finished_games drop constraint if exists finished_games_type_check;
alter table public.finished_games
  add constraint finished_games_type_check check (type in ('online', 'live'));

create index if not exists idx_finished_type_played on public.finished_games (type, played_at);
