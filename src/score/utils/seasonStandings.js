import { seasonTable, playerStandings } from '../../../server/games/results.js'
import { winnerNamesOf } from './winners.js'

/**
 * One season's table, by the rule the server crowns its champion with
 * (seasonTable in server/games/results.js), so the champion is always the
 * top of this table:
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
  return seasonTable(results.map(asGame), from, to)
}

/** The same rows over every result given: each player's games, wins and total. */
export function standingsOf(results) {
  return playerStandings(results.map(asGame))
}

const asGame = r => ({
  playedAt: r.played_at,
  type: r.type,
  players: r.participants,
  winners: winnerNamesOf(r),
})
