// Live win-probability for a game in progress, used by King Online's score
// drawer and ჩაწერა's sheet. Each app draws its own bars.
//
// Model: across all *remaining* rounds, compute the maximum any single
// player can gain (all Plus units) or lose (all penalty units). Best and
// worst cases can happen together across different rounds, so the widest
// gap that can still open or close between two players is
//   swing = maxGain + maxLoss
// and pairwise win chance is a clamped linear model over that range:
//   P(X beats O) = clamp01( (current[X] - current[O] + swing) / (2 * swing) )
// = 0 when X can never catch O, 1 when O can never catch X, 0.5 when tied.
// Each player's score is the product of beating every opponent, then
// normalised so the bars sum to 100%.

import { GAME_TYPE_RULES } from '../server/game/gameTypes.js'

/**
 * The most any one player can still gain and lose, given the type codes of
 * the rounds played so far. Every player leads every type once, so a type
 * has `playerCount` rounds in all. A penalty type's best case is taking
 * nothing, so K (one target) and the count types share one formula.
 */
export function remainingSwing(playedCodes, playerCount) {
  const played = {}
  for (const code of playedCodes) played[code] = (played[code] || 0) + 1
  let maxGain = 0
  let maxLoss = 0
  for (const type of GAME_TYPE_RULES) {
    const remaining = Math.max(0, playerCount - (played[type.code] || 0))
    const magnitude = remaining * type.totalUnits * Math.abs(type.pointsPerUnit)
    if (type.pointsPerUnit < 0) maxLoss += magnitude
    else maxGain += magnitude
  }
  return { maxGain, maxLoss, swing: maxGain + maxLoss }
}

const clamp01 = (v) => Math.max(0, Math.min(1, v))

/**
 * Win chance per player (0–1, summing to 1), in the order of `totals`
 * (each player's current score). With no rounds left the leaders get 1.
 */
export function winProbabilities(totals, playedCodes) {
  if (!totals.length) return []
  const { swing } = remainingSwing(playedCodes, totals.length)

  if (swing === 0) {
    const best = Math.max(...totals)
    return totals.map((t) => (t === best ? 1 : 0))
  }

  const raw = totals.map((mine, i) => {
    let prob = 1
    totals.forEach((theirs, j) => {
      if (i !== j) prob *= clamp01((mine - theirs + swing) / (2 * swing))
    })
    return prob
  })
  const total = raw.reduce((a, b) => a + b, 0)
  // Everyone at 0 can't happen while rounds remain; fall back to no scaling.
  const sum = total > 0 ? total : 1
  return raw.map((p) => p / sum)
}
