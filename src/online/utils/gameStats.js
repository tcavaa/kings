// Per-player totals for one finished game, from its round details. Shared by
// the results screen and the leaderboard's game report so both always show
// the same numbers for the same game.
//
// The server records queens, jacks, hearts and the K♥ taker for every
// trick of every round, whatever the contract. They only count in the round
// where they mattered (queens in 'Q', jacks in 'J', hearts in 'H', K♥ in
// 'K'), the same rule as the server's lifetime stats, so totals can never
// exceed a game's real maximums (12 queens, 12 jacks, 24 hearts, 3 K♥).

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
      roundsLed: 0,
      totalTricks: 0,
      queens: 0,
      jacks: 0,
      hearts: 0,
      kingsOfHearts: 0,
      bestRound: emptyRound(-Infinity),
      worstRound: emptyRound(Infinity),
    }
  }
  for (const d of details || []) {
    if (tally[d.leaderSeat]) tally[d.leaderSeat].roundsLed++
    for (const seat of Object.keys(tally).map(Number)) {
      const t = tally[seat]
      t.totalTricks += d.tricksTaken?.[seat] ?? 0
      if (d.gameType === 'Q') t.queens += d.queensTaken?.[seat] ?? 0
      if (d.gameType === 'J') t.jacks += d.jacksTaken?.[seat] ?? 0
      if (d.gameType === 'H') t.hearts += d.heartsTaken?.[seat] ?? 0
      if (d.gameType === 'K' && d.kingOfHeartsTakenBy === seat) t.kingsOfHearts++
      const score = d.scores?.[seat] ?? 0
      if (score > t.bestRound.score) t.bestRound = { score, round: d.round, type: d.gameType }
      if (score < t.worstRound.score) t.worstRound = { score, round: d.round, type: d.gameType }
    }
  }
  return tally
}
