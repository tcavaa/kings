import { useMemo } from 'react'
import { winProbabilities } from '../../../shared/winProbability.js'
import { totalsByPlayer } from '../utils/rounds'

// The model (how far the scores can still move in the rounds left) is shared
// with King Online: see shared/winProbability.js.
export default function WinProbability({ players, rounds, playerColors = [] }) {
  const probs = useMemo(() => {
    if (!players || players.length === 0) return []
    const totals = totalsByPlayer(players, rounds)
    const chances = winProbabilities(
      players.map(p => totals[p.id]),
      rounds.map(r => r.gameTypeCode),
    )
    return players.map((p, i) => ({
      player: p,
      prob: chances[i],
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
