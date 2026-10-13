-- ─────────────────────────────────────────────────────────────────────────────
-- A season's champions as a list. champion_name keeps the display text
-- ("A & B" on a tie); champion_names is what the apps read to know who won,
-- so a name that itself contains " & " can never be split apart.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.seasons add column if not exists champion_names text[];

update public.seasons
   set champion_names = string_to_array(champion_name, ' & ')
 where champion_name is not null and champion_names is null;
