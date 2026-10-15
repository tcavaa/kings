// Per-player form, streaks, multi-player comparison and all-time records for
// the leaderboard. Pure functions over the API's finished games, so they work
// the same for online, live (ჩაწერა) and mixed lists.

import { winnerNames } from '../../../server/games/results.js'

/**
 * Players taken off the shared player list (ჩაწერა players who had no King
 * Online name). Their old table games keep their name, but they are no longer
 * ranked or paired with anyone.
 */
export const isRemovedPlayer = (p) => p?.profileId === null

const timeOf = (g) => new Date(g.playedAt).getTime() || 0
const oldestFirst = (games) => [...games].sort((a, b) => timeOf(a) - timeOf(b))
const newestFirst = (games) => [...games].sort((a, b) => timeOf(b) - timeOf(a))
const seatOf = (game, name) => (game.players || []).find((p) => p.name === name)
const scoreOf = (p) => Number(p?.score) || 0

/**
 * `name`'s result in a game, Flashscore style: 'W' for a sole win, 'D' for a
 * shared top score (a tie), 'L' otherwise. null when they didn't play.
 */
export function resultOf(game, name) {
  if (!seatOf(game, name)) return null
  const winners = winnerNames(game)
  if (!winners.includes(name)) return 'L'
  return winners.length > 1 ? 'D' : 'W'
}

/**
 * The last `n` games `name` played, newest first:
 * [{ game, result, players }] with the table sorted by score, best first.
 */
export function recentForm(games, name, n = 5) {
  const out = []
  for (const game of newestFirst(games)) {
    const result = resultOf(game, name)
    if (!result) continue
    const players = [...(game.players || [])].sort((a, b) => scoreOf(b) - scoreOf(a))
    out.push({ game, result, players })
    if (out.length >= n) break
  }
  return out
}

/**
 * `name`'s streaks over the games given: the current run of one result
 * ({ result, length }, null with no games) and the longest run of wins
 * (shared wins count) and of games without one.
 */
export function streaksOf(games, name) {
  let current = null
  let win = 0, loss = 0, longestWin = 0, longestLoss = 0
  for (const game of oldestFirst(games)) {
    const result = resultOf(game, name)
    if (!result) continue
    current = current?.result === result
      ? { result, length: current.length + 1 }
      : { result, length: 1 }
    if (result === 'L') { loss++; win = 0 } else { win++; loss = 0 }
    longestWin = Math.max(longestWin, win)
    longestLoss = Math.max(longestLoss, loss)
  }
  return { current, longestWin, longestLoss }
}

/** One player's record over `games`: wins, draws (shared wins), averages. */
function recordOf(games, name) {
  const row = {
    name, games: 0, wins: 0, draws: 0, totalScore: 0,
    best: -Infinity, worst: Infinity, liveWins: 0, onlineWins: 0,
    liveGames: 0, onlineGames: 0, places: 0,
  }
  for (const game of games) {
    const me = seatOf(game, name)
    if (!me) continue
    const s = scoreOf(me)
    const live = game.type === 'live'
    row.games++
    row.totalScore += s
    row.best = Math.max(row.best, s)
    row.worst = Math.min(row.worst, s)
    if (live) row.liveGames++
    else row.onlineGames++
    // Finishing place: 1 + how many scored more (ties share a place).
    row.places += 1 + (game.players || []).filter((p) => scoreOf(p) > s).length
    const result = resultOf(game, name)
    if (result !== 'L') {
      row.wins++
      if (result === 'D') row.draws++
      if (live) row.liveWins++
      else row.onlineWins++
    }
  }
  return {
    ...row,
    winPct: row.games ? Math.round((row.wins / row.games) * 100) : null,
    avg: row.games ? Math.round((row.totalScore / row.games) * 10) / 10 : null,
    avgPlace: row.games ? Math.round((row.places / row.games) * 10) / 10 : null,
  }
}

/** Average round score per game type for `name` over `games`: { code: { avg, count } }. */
function typeAveragesOf(games, name) {
  const out = {}
  for (const game of games) {
    const me = seatOf(game, name)
    if (!me) continue
    for (const d of game.roundDetails || []) {
      if (!d?.gameType) continue
      const t = (out[d.gameType] ||= { total: 0, count: 0 })
      t.total += Number(d.scores?.[me.seat]) || 0
      t.count++
    }
  }
  for (const t of Object.values(out)) t.avg = Math.round((t.total / t.count) * 10) / 10
  return out
}

/**
 * Compare 2–4 players. `shared` is every game all of them played; `ahead[a][b]`
 * is how often `a` outscored `b` there. `rows` and `byType` cover the shared
 * games, or each player's whole record with `scope: 'all'`.
 */
export function comparePlayers(games, names, { scope = 'shared' } = {}) {
  const shared = newestFirst(games.filter((g) => names.every((n) => seatOf(g, n))))
  const ahead = {}
  for (const a of names) {
    ahead[a] = {}
    for (const b of names) {
      if (a === b) continue
      ahead[a][b] = shared.filter((g) => scoreOf(seatOf(g, a)) > scoreOf(seatOf(g, b))).length
    }
  }
  const pool = scope === 'all' ? games : shared
  return {
    shared,
    live: shared.filter((g) => g.type === 'live').length,
    online: shared.filter((g) => g.type !== 'live').length,
    ahead,
    rows: names.map((n) => recordOf(pool, n)),
    byType: Object.fromEntries(names.map((n) => [n, typeAveragesOf(pool, n)])),
  }
}

/**
 * All-time records over `games` (removed players left out). Each record is
 * { value, name, game } or null when nothing qualifies:
 * highScore, lowScore, biggestMargin, closestFinish (sole winners only),
 * bestRound (+ gameType), longestStreak (+ from/to games), longestGame
 * (seconds; only ჩაწერა games keep a length).
 */
export function allTimeRecords(games) {
  const rec = {
    highScore: null, lowScore: null, biggestMargin: null, closestFinish: null,
    bestRound: null, longestStreak: null, longestGame: null,
  }
  const better = (key, value, entry, higher = true) => {
    const cur = rec[key]
    if (!cur || (higher ? value > cur.value : value < cur.value)) rec[key] = { value, ...entry }
  }
  const names = new Set()
  for (const game of oldestFirst(games)) {
    const players = (game.players || []).filter((p) => !isRemovedPlayer(p))
    if (!players.length) continue
    for (const p of players) {
      names.add(p.name)
      better('highScore', scoreOf(p), { name: p.name, game })
      better('lowScore', scoreOf(p), { name: p.name, game }, false)
    }
    const winners = winnerNames(game)
    const all = [...(game.players || [])].sort((a, b) => scoreOf(b) - scoreOf(a))
    const top = all[0]
    if (winners.length === 1 && all.length > 1 && !isRemovedPlayer(top)) {
      const margin = scoreOf(top) - scoreOf(all[1])
      if (margin > 0) {
        better('biggestMargin', margin, { name: top.name, game })
        better('closestFinish', margin, { name: top.name, game }, false)
      }
    }
    for (const d of game.roundDetails || []) {
      for (const p of players) {
        const s = d?.scores?.[p.seat]
        if (s == null) continue
        better('bestRound', Number(s) || 0, { name: p.name, game, gameType: d.gameType })
      }
    }
    if (Number(game.durationSeconds) > 0) {
      better('longestGame', Number(game.durationSeconds), { name: winners.join(' & ') || null, game })
    }
  }
  // Longest run of games won (shared wins count) by any one player.
  for (const name of names) {
    let run = 0, from = null
    for (const game of oldestFirst(games)) {
      const result = resultOf(game, name)
      if (!result || isRemovedPlayer(seatOf(game, name))) continue
      if (result === 'L') { run = 0; continue }
      if (!run) from = game
      run++
      better('longestStreak', run, { name, game, from })
    }
  }
  return rec
}
