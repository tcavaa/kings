// Round entry and running totals, shared by the round form, the last-round
// edit, the charts and the live-sheet list. The totals themselves are
// worked out by shared/totals.js, which King Online's charts use too.

import { totalsOf, runningTotals } from '../../../shared/totals.js'

/** A typed or stepped card count as a whole number of at least 0. */
export function normalizeCount(value) {
  const n = Math.trunc(Number(value) || 0)
  return n > 0 ? n : 0
}

export function countsSum(countsByPlayerId) {
  return Object.values(countsByPlayerId || {}).reduce((a, b) => a + (Number(b) || 0), 0)
}

/**
 * Why a round can't be entered yet ('' when it can). The server refuses a
 * whole game over one non-integer count, so every count is checked here.
 */
export function validateRound(type, countsByPlayerId, singleTargetPlayerId) {
  if (!type) return 'Choose a game type'
  if (type.kind === 'count') {
    const counts = Object.values(countsByPlayerId || {})
    if (counts.some(v => !Number.isInteger(v) || v < 0)) return 'Card counts must be whole numbers'
    if (countsSum(countsByPlayerId) !== type.totalUnits) {
      return `Distribute exactly ${type.totalUnits} ${type.unitLabel || 'units'} across players`
    }
  }
  if (type.kind === 'single' && !singleTargetPlayerId) return 'Select the player who took it'
  return ''
}

/** { [playerId]: total } over the given rounds (shared/totals.js). */
export function totalsByPlayer(players, rounds) {
  return totalsOf(players.map(p => p.id), rounds)
}

/** The running totals after each round: [{ [playerId]: total }, ...]. */
export function cumulativeTotals(players, rounds) {
  return runningTotals(players.map(p => p.id), rounds)
}
