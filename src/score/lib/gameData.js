// Players and games for every screen, from the app's API: one player list
// (King Online's profiles) and one games table (King Online's games plus the
// ones recorded here). Loaded once and shared by all hooks; saving a game
// reloads it.

import { useEffect, useState } from 'react'
import { liveGameToLegacy, onlineGameToLegacy } from './gameShapes'

let current = null              // Promise of the loaded data
const listeners = new Set()

async function request(url, options) {
  const res = await fetch(url, options)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

const byPlayedAtDesc = (a, b) => new Date(b.played_at) - new Date(a.played_at)

async function load() {
  const [profiles, games] = await Promise.all([
    request('/api/players'),
    request('/api/games?limit=all&avatars=0'),
  ])
  // `online_name` is the player's own name now: one name per person in both apps.
  const players = profiles.map(p => ({ id: p.id, name: p.name, online_name: p.name, created_at: p.created_at }))
  const idByName = new Map(players.map(p => [p.name, p.id]))
  const idOfName = name => idByName.get(name) ?? `guest:${name}`

  const live = { results: [], details: [] }
  const online = { results: [], details: [], games: [] }
  for (const game of games) {            // newest first
    if (game.type === 'live') {
      const { result, detail } = liveGameToLegacy(game)
      live.results.push(result)
      if (detail) live.details.push(detail)
    } else if (game.isChampionship) {    // ჩაწერა has always counted league games only
      online.games.push(game)
      const { result, detail } = onlineGameToLegacy(game, idOfName)
      online.results.push(result)
      if (detail) online.details.push(detail)
    }
  }
  live.details.sort(byPlayedAtDesc)
  online.details.sort(byPlayedAtDesc)
  return { players, live, online }
}

// A failed load is not kept: the next screen that asks tries again.
function start() {
  const promise = load()
  promise.catch(() => { if (current === promise) current = null })
  current = promise
  return promise
}

function loadGameData() {
  return current || start()
}

/** Reload after a change (a new game). */
function reloadGameData() {
  const promise = start()
  listeners.forEach(fn => fn(promise))
  return promise
}

export async function saveGame({ players, rounds, durationSeconds }) {
  await request('/api/games/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ players, rounds, durationSeconds }),
  })
  reloadGameData().catch(() => {})
}

// ── live sheets: games being scored right now, for others to follow ──

/** Publish this device's sheet (fire and forget — the next change retries). */
export function publishLiveSheet(id, state) {
  return fetch(`/api/live-sheets/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
    keepalive: true,
  }).catch(() => {})
}

export function removeLiveSheet(id) {
  return fetch(`/api/live-sheets/${encodeURIComponent(id)}`, { method: 'DELETE', keepalive: true }).catch(() => {})
}

/** Sheets being played right now (null until loaded), refreshed every few seconds. */
export function useLiveSheets(intervalMs = 8000) {
  const [sheets, setSheets] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => request('/api/live-sheets').then(s => { if (alive) setSheets(s) }, () => {})
    load()
    const t = setInterval(load, intervalMs)
    return () => { alive = false; clearInterval(t) }
  }, [intervalMs])
  return sheets
}

/** { data, loading, error } — data is null until the first load finishes. */
export function useGameData() {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let alive = true
    const follow = promise => promise.then(
      data => { if (alive) setState({ data, loading: false, error: null }) },
      err => { if (alive) setState(s => ({ ...s, loading: false, error: err.message })) },
    )
    follow(loadGameData())
    listeners.add(follow)
    return () => { alive = false; listeners.delete(follow) }
  }, [])
  return state
}

/** Games of the chosen type ('all' | 'online' | 'live'), newest first. */
export function gamesOfType(data, type) {
  if (!data) return { results: [], details: [] }
  if (type === 'live') return data.live
  if (type === 'online') return data.online
  return {
    results: [...data.live.results, ...data.online.results].sort(byPlayedAtDesc),
    details: [...data.live.details, ...data.online.details].sort(byPlayedAtDesc),
  }
}
