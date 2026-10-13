// Per-player totals for one finished game, from its round details. Shared by
// the results screen and the leaderboard's game report so both always show
// the same numbers for the same game.
//
// What one round adds (queens only in 'Q', jacks only in 'J', …) is the
// server's lifetime-stats rule, from server/games/results.js.

import { emptyRoundStats, addRoundStats } from '../../../server/games/results.js'

const emptyRound = (score) => ({ score, round: null, type: null })

/**
 * @param {{seat:number}[]} playerList
 * @param {object[]} details  roundDetails: { round, gameType, leaderSeat,
 *   scores, tricksTaken, queensTaken, jacksTaken, heartsTaken,
 *   kingOfHeartsTakenBy }
 * @returns {Record<number, {roundsLed, totalTricks, queens, jacks, hearts,
 *   kingsOfHearts, bestRound, worstRound}>}
 */
export function computeGameStats(playerList, details) {
  const tally = {}
  for (const { seat } of playerList || []) {
    tally[seat] = {
      ...emptyRoundStats(),
      bestRound: emptyRound(-Infinity),
      worstRound: emptyRound(Infinity),
    }
  }
  for (const d of details || []) {
    for (const seat of Object.keys(tally).map(Number)) {
      const t = addRoundStats(tally[seat], d, seat)
      const score = d.scores?.[seat] ?? 0
      if (score > t.bestRound.score) t.bestRound = { score, round: d.round, type: d.gameType }
      if (score < t.worstRound.score) t.worstRound = { score, round: d.round, type: d.gameType }
    }
  }
  return tally
}
