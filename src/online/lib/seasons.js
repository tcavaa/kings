// The season table both the leaderboard's Seasons tab and the homepage show.
// Seasons are King Score's: each has a start, an end (none while it runs)
// and a champion. A season counts league games — online ones and the ones
// recorded at a table — by the rule the server crowns the champion with,
// the same one the score app's season tables use (server/games/results.js).

import { inSeason, seasonTable, winnerNames } from '../../../server/games/results.js'

/** League games only: casual online games never count toward a season. */
export const leagueGames = (games) => games.filter((g) => g.isChampionship !== false)

/**
 * The running season ({ season, start }) from the API's season list. A
 * season starts where its row says, or where the last one ended.
 */
export function currentSeasonOf(seasons) {
  const season = (seasons || []).find((s) => !s.ended_at) || null
  const lastEnded = (seasons || []).filter((s) => s.ended_at)[0]
  return { season, start: season?.started_at || lastEnded?.ended_at || null }
}

/** The league games played since `start` (none without a start). */
export const gamesSince = (games, start) =>
  start ? leagueGames(games).filter((g) => inSeason(g.playedAt, start)) : []

/** A season's table rows, best first, with each player's photo from their games. */
export function standingsOf(games) {
  const avatars = new Map()
  for (const g of games) {
    for (const p of g.players || []) if (p.avatar && !avatars.has(p.name)) avatars.set(p.name, p.avatar)
  }
  const table = seasonTable(
    games.map((g) => ({ playedAt: g.playedAt, type: g.type, players: g.players, winners: winnerNames(g) })),
  )
  return table.map((r) => ({ ...r, gamesPlayed: r.games, avatar: avatars.get(r.name) || null }))
}
