// The season list, fetched once per page load and shared by everyone who
// asks: the last finished season's champion(s) wear a crown wherever King
// Online shows them (on their photo, on their seat at the table, in every
// list), and every season's champions earn SEASON_CHAMPION.

import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'

const NONE = []

let seasons = NONE
let loading = null
const listeners = new Set()

/** The champions of the season that ended last ("A & B" rows predate the list). */
export function lastChampionsOf(rows) {
  const last = (rows || [])
    .filter((s) => s.ended_at)
    .sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at))[0]
  if (!last) return []
  return last.champion_names || String(last.champion_name || '').split(' & ').filter(Boolean)
}

function load() {
  if (!loading) {
    loading = api.listSeasons().then(
      (rows) => {
        seasons = Array.isArray(rows) ? rows : NONE
        listeners.forEach((fn) => fn(seasons))
      },
      // No crown is better than a broken page; the next mount tries again.
      () => { loading = null },
    )
  }
  return loading
}

/** Every season, as the API lists them (empty until they load). */
export function useSeasonList() {
  const [rows, setRows] = useState(seasons)
  useEffect(() => {
    listeners.add(setRows)
    setRows(seasons)
    load()
    return () => { listeners.delete(setRows) }
  }, [])
  return rows
}

/** A Set of the last season's champion names (empty until it loads). */
export function useLastChampions() {
  const rows = useSeasonList()
  return useMemo(() => new Set(lastChampionsOf(rows)), [rows])
}
