import { useState, useEffect, useMemo } from 'react'
import { seasonChampions } from '../utils/winners'

// Seasons, read-only: they are named and ended from King Online's
// /admin. Completed seasons have `ended_at` set; the CURRENT season is the
// single row with `ended_at` NULL. Without such a row the current season
// starts when the last one ended.

export function useSeasons() {
  const [rows, setRows] = useState([])

  useEffect(() => {
    let alive = true
    fetch('/api/seasons')
      .then(r => (r.ok ? r.json() : []))
      .then(data => { if (alive && Array.isArray(data)) setRows(data) })
      .catch(() => { /* no seasons shown; the app still works */ })
    return () => { alive = false }
  }, [])

  // Completed seasons, newest first (what the champions tab lists).
  const seasons = useMemo(
    () => rows
      .filter(r => r.ended_at)
      .sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at)),
    [rows]
  )

  const currentSeason = useMemo(() => rows.find(r => !r.ended_at) || null, [rows])

  // Most recent completed season's champion (may be "A & B" on a tie).
  const currentChampion = seasons[0] ? seasonChampions(seasons[0]) : null

  const currentSeasonStart = useMemo(() => (
    currentSeason?.started_at
      ? new Date(currentSeason.started_at)
      : (seasons[0] ? new Date(seasons[0].ended_at) : null)
  ), [currentSeason, seasons])

  return {
    seasons,
    currentChampion,
    currentSeasonStart,
    currentSeasonName: currentSeason?.name || null,
  }
}
