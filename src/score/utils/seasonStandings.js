import { winnerNamesOf } from './winners.js'

/**
 * One season's table, by the rule the server crowns its champion with
 * (seasonStandings in server/db/store.js), so the champion is always the top
 * of this table:
 * - every game recorded here and every King Online championship game played
 *   after `from` (and, for a finished season, up to `to`), whether or not it
 *   has round details;
 * - each winner of a tie gets a win;
 * - players are counted by name, including ones since removed from the list.
 *
 * `results` are result rows of both kinds (gameShapes.js). Returns rows
 * { name, wins, liveWins, onlineWins, games, totalScore }, most wins first.
 */
export function seasonStandings(results, from, to = null) {
  const fromMs = from ? new Date(from).getTime() : -Infinity
  const toMs = to ? new Date(to).getTime() : Infinity
  const rows = new Map()
  const rowOf = (name) => {
    if (!rows.has(name)) rows.set(name, { name, wins: 0, liveWins: 0, onlineWins: 0, games: 0, totalScore: 0 })
    return rows.get(name)
  }
  for (const r of results) {
    const t = new Date(r.played_at).getTime()
    if (!(t > fromMs && t <= toMs)) continue
    for (const p of r.participants || []) {
      const row = rowOf(p.name)
      row.games++
      row.totalScore += Number(p.score) || 0
    }
    for (const name of new Set(winnerNamesOf(r))) {
      const row = rowOf(name)
      row.wins++
      if (r.type === 'online') row.onlineWins++
      else row.liveWins++
    }
  }
  return [...rows.values()].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))
}
