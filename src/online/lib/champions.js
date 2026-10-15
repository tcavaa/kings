// The last finished season's champion(s) wear a crown wherever King Online
// shows them: on their photo, on their seat at the table, in every list.
// Seasons change a few times a year, so the list is fetched once per page
// load and shared by every component that asks.

import { useEffect, useState } from 'react'
import { api } from './api.js'

const NONE = new Set()

let champions = NONE
let loading = null
const listeners = new Set()

/** The champions of the season that ended last ("A & B" rows predate the list). */
export function lastChampionsOf(seasons) {
  const last = (seasons || [])
    .filter((s) => s.ended_at)
    .sort((a, b) => new Date(b.ended_at) - new Date(a.ended_at))[0]
  if (!last) return []
  return last.champion_names || String(last.champion_name || '').split(' & ').filter(Boolean)
}

function load() {
  if (!loading) {
    loading = api.listSeasons().then(
      (seasons) => {
        champions = new Set(lastChampionsOf(seasons))
        listeners.forEach((fn) => fn(champions))
      },
      // No crown is better than a broken page; the next mount tries again.
      () => { loading = null },
    )
  }
  return loading
}

/** A Set of the last season's champion names (empty until it loads). */
export function useLastChampions() {
  const [names, setNames] = useState(champions)
  useEffect(() => {
    listeners.add(setNames)
    setNames(champions)
    load()
    return () => { listeners.delete(setNames) }
  }, [])
  return names
}
