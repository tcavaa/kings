export default function GameProgress({ playedRounds, totalRounds }) {
  if (!totalRounds || totalRounds <= 0) return null

  const pct = Math.min(1, playedRounds / totalRounds)
  const remaining = Math.max(0, totalRounds - playedRounds)

  // Ring geometry
  const size = 130
  const stroke = 12
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct)

  return (
    <div className="card game-progress-card">
      <h2>Game Progress</h2>
      <div className="game-progress-ring-wrap">
        <svg width={size} height={size} className="game-progress-ring">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--line)"
            strokeWidth={stroke}
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--accent-good)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: 'stroke-dashoffset 0.5s ease' }}
          />
        </svg>
        <div className="game-progress-center">
          <div className="game-progress-fraction">{playedRounds} / {totalRounds}</div>
          <div className="game-progress-label">ROUNDS</div>
        </div>
      </div>
      <div className="game-progress-footer">
        <div className="game-progress-remaining-label">Remaining</div>
        <div className="game-progress-remaining-value">{remaining} round{remaining === 1 ? '' : 's'} left</div>
      </div>
    </div>
  )
}
