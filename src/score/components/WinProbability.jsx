import { useMemo } from 'react'
import { GAME_TYPES } from '../constants/gameTypes'

export default function WinProbability({ players, rounds, playerColors = [] }) {
  const probs = useMemo(() => {
    if (!players || players.length === 0) return []

    const n = players.length

    // Current totals
    const totals = {}
    players.forEach(p => { totals[p.id] = 0 })
    rounds.forEach(r => {
      if (r.scores) players.forEach(p => { totals[p.id] += r.scores[p.id] || 0 })
    })

    // Count remaining plays per game type
    const playedCount = {}
    GAME_TYPES.forEach(t => { playedCount[t.code] = 0 })
    rounds.forEach(r => {
      if (playedCount[r.gameTypeCode] !== undefined) playedCount[r.gameTypeCode]++
    })

    // Compute the maximum any single player can gain / lose across all remaining rounds.
    // Best case for a player: 0 on every penalty round, max on every plus round.
    // Worst case for a player: max on every penalty round, 0 on every plus round.
    // These best/worst cases CAN happen simultaneously across different rounds.
    let maxGain = 0  // best possible score boost remaining
    let maxLoss = 0  // best possible score drop remaining (as positive number)

    GAME_TYPES.forEach(type => {
      const remaining = Math.max(0, n - (playedCount[type.code] || 0))
      if (remaining <= 0) return

      if (type.kind === 'single') {
        // e.g. K: one player gets -40, rest get 0. Best case = 0, worst = type.points.
        maxLoss += remaining * Math.abs(type.points)
      } else if (type.pointsPerUnit < 0) {
        // Penalty count (Q, J, H, L2, T): best = 0, worst = take all units.
        maxLoss += remaining * type.totalUnits * Math.abs(type.pointsPerUnit)
      } else {
        // Plus count (P1, P2, P3): best = take all units, worst = 0.
        maxGain += remaining * type.totalUnits * type.pointsPerUnit
      }
    })

    // swing = the maximum gap that can open or close between any two players.
    // If player X takes everything best while player O takes everything worst:
    //   final[X] - final[O] = (current[X] + maxGain) - (current[O] - maxLoss)
    //                       = (current[X] - current[O]) + swing
    const swing = maxGain + maxLoss

    if (swing === 0) {
      // No rounds left — winner is already determined.
      const maxTotal = Math.max(...players.map(p => totals[p.id]))
      return players.map((p, i) => ({
        player: p,
        prob: totals[p.id] === maxTotal ? 1 : 0,
        color: playerColors[i] || '#059669',
      }))
    }

    // Pairwise win probability using linear model over the achievable range:
    //   P(X beats O) = clamp01( (current[X] - current[O] + swing) / (2 * swing) )
    //
    // = 0 when X can never beat O (even X's best < O's worst)
    // = 1 when X always beats O (even X's worst > O's best)
    // = 0.5 when they're tied with any remaining rounds left
    const clamp01 = v => Math.max(0, Math.min(1, v))

    const rawProbs = players.map((p) => {
      // Product of pairwise probabilities of beating every other player
      let prob = 1
      players.forEach(o => {
        if (o.id === p.id) return
        const gap = totals[p.id] - totals[o.id]
        prob *= clamp01((gap + swing) / (2 * swing))
      })
      return prob
    })

    const total = rawProbs.reduce((a, b) => a + b, 0)
    // If everyone is at 0 (shouldn't happen with swing > 0), fall back to equal
    const sum = total > 0 ? total : 1

    return players.map((p, i) => ({
      player: p,
      prob: rawProbs[i] / sum,
      color: playerColors[i] || '#059669',
    }))
  }, [players, rounds, playerColors])

  if (!probs.length || rounds.length === 0) return null

  return (
    <div className="card win-prob-card">
      <h2>Win Probability</h2>
      <div className="win-prob-bars">
        {probs.map(({ player, prob, color }) => (
          <div key={player.id} className="win-prob-row">
            <div className="win-prob-name">{player.name}</div>
            <div className="win-prob-track">
              <div
                className="win-prob-fill"
                style={{ width: `${(prob * 100).toFixed(1)}%`, background: color }}
              />
            </div>
            <div className="win-prob-pct">{(prob * 100).toFixed(0)}%</div>
          </div>
        ))}
      </div>
    </div>
  )
}
