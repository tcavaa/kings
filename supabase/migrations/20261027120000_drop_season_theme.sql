-- ─── drop seasons.theme ───────────────────────────────────────────────────
-- King Score no longer dresses up per season (casual, summer, mountain,
-- christmas), so /admin stops picking a theme and nothing reads it.
alter table public.seasons drop column if exists theme;
