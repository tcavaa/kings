// Players and games for every screen, from the app's API: one player list
// (King Online's profiles) and one games table (King Online's games plus the
// ones recorded here). Each is loaded once and shared by all hooks. The
// player list comes on its own, so the new-game picker doesn't wait for the
// whole game history; saving a game reloads only the games.

import { useEffect, useState } from 'react'
import { liveGameToLegacy, onlineGameToLegacy } from './gameShapes'

async function request(url, options) {
  const res = await fetch(url, options)
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`)
  return body
}

// One shared load. A failed load is not kept: the next screen that asks
// tries again.
function sharedLoad(loader) {
  let current = null
  const start = () => {
    const promise = loader()
    current = promise
    promise.catch(() => { if (current === promise) current = null })
    return promise
  }
  return { get: () => current || start(), reload: start }
}

const playerList = sharedLoad(async () => {
  const profiles = await request('/api/players')
  return profiles.map(p => ({ id: p.id, name: p.name, created_at: p.created_at }))
})

// ჩაწერა counts league games only, and every game recorded here is saved as
// one, so the casual King Online games are never downloaded.
const gameList = sharedLoad(() => request('/api/games?limit=all&avatars=0&mode=championship'))

const byPlayedAtDesc = (a, b) => new Date(b.played_at) - new Date(a.played_at)

function build(players, games) {
  const idByName = new Map(players.map(p => [p.name, p.id]))
  const idOfName = name => idByName.get(name) ?? `guest:${name}`
  const knownIds = new Set(players.map(p => p.id))

  const live = { results: [], details: [] }
  const online = { results: [], details: [], games: [] }
  for (const game of games) {            // newest first
    if (game.type === 'live') {
      const { result, detail } = liveGameToLegacy(game, { knownIds, idOfName })
      live.results.push(result)
      if (detail) live.details.push(detail)
    } else if (game.isChampionship) {
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

// The rows are rebuilt only when the players or the games actually changed,
// so every screen shares one copy.
let built = null
function loadGameData() {
  return Promise.all([playerList.get(), gameList.get()]).then(([players, games]) => {
    if (built?.players !== players || built?.games !== games) built = { players, games, data: build(players, games) }
    return built.data
  })
}

const listeners = new Set()

/** Reload the games after a change (a new game). */
function reloadGames() {
  gameList.reload().catch(() => {})
  listeners.forEach(fn => fn())
}

export async function saveGame({ sheetId, players, rounds, durationSeconds }) {
  await request('/api/games/live', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sheetId, players, rounds, durationSeconds }),
  })
  reloadGames()
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

/**
 * Sheets being played right now (null until loaded), refreshed every few
 * seconds while the page is visible: a phone left in a pocket doesn't poll.
 */
export function useLiveSheets(intervalMs = 8000) {
  const [sheets, setSheets] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => {
      if (document.hidden) return
      request('/api/live-sheets').then(s => { if (alive) setSheets(s) }, () => {})
    }
    load()
    const t = setInterval(load, intervalMs)
    document.addEventListener('visibilitychange', load)
    return () => { alive = false; clearInterval(t); document.removeEventListener('visibilitychange', load) }
  }, [intervalMs])
  return sheets
}

// Follows a shared load: only the newest load a hook asked for is applied,
// so an older one that finishes late can't overwrite newer data.
function useShared(load, subscribe) {
  const [state, setState] = useState({ data: null, loading: true, error: null })
  useEffect(() => {
    let latest = null
    const follow = () => {
      const promise = load()
      latest = promise
      promise.then(
        data => { if (latest === promise) setState({ data, loading: false, error: null }) },
        err => { if (latest === promise) setState(s => ({ ...s, loading: false, error: err.message })) },
      )
    }
    follow()
    if (subscribe) listeners.add(follow)
    return () => { latest = null; listeners.delete(follow) }
  }, [load, subscribe])
  return state
}

/** { data, loading, error } — data is null until the first load finishes. */
export function useGameData() {
  return useShared(loadGameData, true)
}

/** { data: players, loading, error } — the player list alone, without the games. */
export function usePlayerList() {
  return useShared(playerList.get, false)
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
