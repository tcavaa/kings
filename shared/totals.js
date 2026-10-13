// Running totals over a game's rounds, for both apps' score tables and
// charts. Rounds carry `scores` keyed by seat (King Online) or by player id
// (ჩაწერა); `keys` says which.

// Rounds can come from another phone's live sheet, so a missing round or
// score counts as 0 rather than breaking the sum.
const scoreIn = (round, key) => {
  const v = round?.scores?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/** { [key]: total } over the given rounds. */
export function totalsOf(keys, rounds) {
  const totals = Object.fromEntries(keys.map(k => [k, 0]))
  ;(rounds || []).forEach(r => keys.forEach(k => { totals[k] += scoreIn(r, k) }))
  return totals
}

/** The running totals after each round: [{ [key]: total }, ...]. */
export function runningTotals(keys, rounds) {
  const running = Object.fromEntries(keys.map(k => [k, 0]))
  return (rounds || []).map(r => {
    keys.forEach(k => { running[k] += scoreIn(r, k) })
    return { ...running }
  })
}
