-- ─────────────────────────────────────────────────────────────────────────────
-- finished_games indexes. The only query that filters finished_games by date
-- is the daily championship quota (is_championship = 1 AND type = 'online'
-- AND played_at >= today), which (is_championship, played_at) serves. Every
-- other reader goes through the per-process mirror, which reads all rows.
-- The plain played_at index and the overlapping (type, played_at) one only
-- slow down writes.
-- ─────────────────────────────────────────────────────────────────────────────

drop index if exists public.idx_finished_played_at;
drop index if exists public.idx_finished_type_played;
