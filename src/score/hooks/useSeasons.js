import { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import { DEFAULT_THEME } from '../utils/themes'

// Seasons live in the `seasons` table. Completed seasons have `ended_at`
// set; the CURRENT season is the single row with `ended_at IS NULL` and
// carries the user-chosen `name` + `theme`. Older deployments have neither
// the extra columns nor a current row — everything degrades gracefully:
// the current season is then derived from the last completed row and shows
// no name until the migration below is run in the Supabase SQL editor:
//
//   alter table seasons add column if not exists name text;
//   alter table seasons add column if not exists theme text;
//   alter table seasons alter column champion_name drop not null;
//   alter table seasons alter column ended_at drop not null;
//   alter table seasons alter column started_at set default now();

export function useSeasons() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchSeasons = useCallback(async () => {
    const { data } = await supabase
      .from('seasons')
      .select('*')
      .order('started_at', { ascending: false })
    if (data) setRows(data)
    setLoading(false)
  }, [])

  useEffect(() => { fetchSeasons() }, [fetchSeasons])

  // Completed seasons, newest first (what the champions tab lists).
  const seasons = useMemo(
    () => rows
      .filter(r => r.ended_at)
      .sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at)),
    [rows]
  )

  // The open season row (ended_at IS NULL), if the migration has been run
  // and a season was started through the app.
  const currentSeason = useMemo(() => rows.find(r => !r.ended_at) || null, [rows])

  // Most recent completed season's champion (may be "A & B" on a tie).
  const currentChampion = seasons[0]?.champion_name ?? null

  // Current season starts when its row says so; without a current row we
  // fall back to the legacy definition: after the last season ended.
  const currentSeasonStart = useMemo(() => (
    currentSeason?.started_at
      ? new Date(currentSeason.started_at)
      : (seasons[0] ? new Date(seasons[0].ended_at) : null)
  ), [currentSeason, seasons])

  const currentSeasonTheme = currentSeason?.theme || DEFAULT_THEME
  const currentSeasonName = currentSeason?.name || null

  /**
   * Close the current season and open the next one.
   *  - championName: winner(s) of the season being closed
   *  - endedAt / startedAt: ISO bounds of the season being closed
   *  - nextName / nextTheme: the user's choice for the NEW season
   * Returns null on success or an error message. Works (minus name/theme)
   * against a pre-migration table so ending a season never breaks.
   */
  const endSeason = useCallback(async ({ championName, startedAt, endedAt, nextName, nextTheme }) => {
    // 1. Close the open row if there is one; otherwise insert a completed
    //    row (legacy behaviour).
    let closeError = null
    if (currentSeason) {
      const { error } = await supabase
        .from('seasons')
        .update({ champion_name: championName, ended_at: endedAt })
        .eq('id', currentSeason.id)
      closeError = error
    } else {
      const { error } = await supabase.from('seasons').insert({
        champion_name: championName,
        started_at: startedAt,
        ended_at: endedAt,
      })
      closeError = error
    }
    if (closeError) return closeError.message

    // 2. Open the new season with its name + theme. If the name/theme
    //    columns don't exist yet, retry with the bare row so the app keeps
    //    working and surface a hint about the migration.
    let migrationHint = null
    let { error: openError } = await supabase.from('seasons').insert({
      name: nextName || null,
      theme: nextTheme || DEFAULT_THEME,
      started_at: endedAt,
      champion_name: null,
      ended_at: null,
    })
    if (openError) {
      const retry = await supabase.from('seasons').insert({
        started_at: endedAt,
        champion_name: null,
        ended_at: null,
      })
      openError = retry.error
      if (!openError) {
        migrationHint = 'Season name/theme not saved — run the seasons migration in Supabase.'
      }
    }
    await fetchSeasons()
    // A failed "open" is non-fatal: the close already happened, the app
    // just falls back to legacy current-season behaviour.
    if (openError) return `Season closed, but the new season row failed: ${openError.message}`
    return migrationHint
  }, [currentSeason, fetchSeasons])

  /**
   * Rename / re-theme the current season (creates the current row on the
   * fly for setups that predate current-season rows).
   */
  const updateCurrentSeason = useCallback(async ({ name, theme }) => {
    if (currentSeason) {
      const { error } = await supabase
        .from('seasons')
        .update({ name: name ?? currentSeason.name, theme: theme ?? currentSeason.theme })
        .eq('id', currentSeason.id)
      if (!error) await fetchSeasons()
      return error?.message ?? null
    }
    const startedAt = (currentSeasonStart || new Date()).toISOString()
    const { error } = await supabase.from('seasons').insert({
      name: name || null,
      theme: theme || DEFAULT_THEME,
      started_at: startedAt,
      champion_name: null,
      ended_at: null,
    })
    if (!error) await fetchSeasons()
    return error?.message ?? null
  }, [currentSeason, currentSeasonStart, fetchSeasons])

  return {
    seasons,
    loading,
    currentSeason,
    currentSeasonName,
    currentSeasonTheme,
    currentChampion,
    currentSeasonStart,
    endSeason,
    updateCurrentSeason,
    refetch: fetchSeasons,
  }
}
