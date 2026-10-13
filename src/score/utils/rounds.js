// Round entry and running totals, shared by the round form, the last-round
// edit, the charts and the live-sheet list. (They sit next to scoring.js
// rather than in it while that file is being merged with King Online's.)

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

// Rounds can come from another phone's live sheet, so a missing round or
// score counts as 0 rather than breaking the sum.
const scoreIn = (round, id) => {
  const v = round?.scores?.[id]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** { [playerId]: total } over the given rounds. */
export function totalsByPlayer(players, rounds) {
  const totals = Object.fromEntries(players.map(p => [p.id, 0]))
  ;(rounds || []).forEach(r => players.forEach(p => { totals[p.id] += scoreIn(r, p.id) }))
  return totals
}

/** The running totals after each round: [{ [playerId]: total }, ...]. */
export function cumulativeTotals(players, rounds) {
  const running = Object.fromEntries(players.map(p => [p.id, 0]))
  return (rounds || []).map(r => {
    players.forEach(p => { running[p.id] += scoreIn(r, p.id) })
    return { ...running }
  })
}
