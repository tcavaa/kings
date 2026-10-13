// Leaderboard reads go straight to the server. No local cache — the
// leaderboard is shared across everyone, so a per-device cache would just
// hide newly-saved games until the user manually refreshes.

import { api } from './api'
import { winnerNames } from '../../../server/games/results.js'

export const listGames = (limit = 50) => api.listGames(limit)

/**
 * Did `name` win this game (including shared/tied wins)? Every winner of a
 * tie counts; older records only carry the single `winner`
 * (server/games/results.js reads both).
 */
export function isWinnerName(game, name) {
  return winnerNames(game).includes(name)
}

/**
 * Players taken off the shared player list (ჩაწერა players who had no King
 * Online name). Their old table games keep their name, but they are no longer
 * ranked or paired with anyone.
 */
export const isRemovedPlayer = (p) => p?.profileId === null

/**
 * Every pair of (current) players who shared a table, with each side's wins,
 * total and best score: { a, b, aWins, bWins, aTotal, bTotal, aBest, bBest,
 * gamesShared }, names sorted so `a` < `b`. Computed once for the head-to-head
 * and rivalry panels.
 */
export function buildPairStats(games = []) {
  const map = new Map()
  for (const g of games) {
    const players = (g.players || []).filter((p) => !isRemovedPlayer(p))
    if (players.length < 2) continue
    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const A = players[i], B = players[j]
        const [first, second] = [A.name, B.name].sort()
        const key = `${first}\u0000${second}`
        const aFirst = first === A.name
        const row = map.get(key) || {
          a: first, b: second,
          aWins: 0, bWins: 0, aTotal: 0, bTotal: 0,
          aBest: -Infinity, bBest: -Infinity, gamesShared: 0,
        }
        row.gamesShared += 1
        const aScore = Number(aFirst ? A.score : B.score) || 0
        const bScore = Number(aFirst ? B.score : A.score) || 0
        row.aTotal += aScore
        row.bTotal += bScore
        if (aScore > row.aBest) row.aBest = aScore
        if (bScore > row.bBest) row.bBest = bScore
        // Tie-aware: a shared top score means both names take a win.
        if (isWinnerName(g, row.a)) row.aWins += 1
        if (isWinnerName(g, row.b)) row.bWins += 1
        map.set(key, row)
      }
    }
  }
  return Array.from(map.values())
}

/** Aggregate stats per player name across the supplied games array. */
export function aggregatePlayers(games = []) {
  const tally = new Map()
  for (const g of games) {
    for (const p of g.players || []) {
      if (isRemovedPlayer(p)) continue
      const k = p.name
      const t = tally.get(k) || {
        name: p.name, avatar: p.avatar || null,
        gamesPlayed: 0, wins: 0, totalScore: 0,
        bestScore: -Infinity, worstScore: Infinity,
      }
      // One number for both the comparison and the stored value, so a game
      // without a score can't leave best/worst undefined for good.
      const s = Number(p.score) || 0
      t.gamesPlayed++
      if (isWinnerName(g, p.name)) t.wins++
      t.totalScore += s
      if (s > t.bestScore)  t.bestScore  = s
      if (s < t.worstScore) t.worstScore = s
      if (!t.avatar && p.avatar) t.avatar = p.avatar
      tally.set(k, t)
    }
  }
  return Array.from(tally.values())
    .sort((a, b) => b.wins - a.wins || b.totalScore - a.totalScore)
}
