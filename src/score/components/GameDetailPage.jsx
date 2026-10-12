import { Timer } from 'lucide-react'
import ScoreChart from './ScoreChart'
import GameAnalytics from './GameAnalytics'
import { formatDuration } from '../utils/time'

export default function GameDetailPage({ detail, result, onBack }) {
  const { players, rounds } = detail
  const date = new Date(detail.played_at).toLocaleDateString()

  return (
    <div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>Game Details</h2>
            <div style={{ color: 'var(--muted)', fontSize: 14, display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {date} · {players.map(p => p.name).join(', ')}
              {result?.duration_seconds != null && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  · <Timer size={13} /> {formatDuration(result.duration_seconds)}
                </span>
              )}
            </div>
            {result && (
              <div style={{ marginTop: 6 }}>
                Winner: <strong>{result.winner_name}</strong>
                {result.participants && (
                  <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>
                    ({result.participants.map(p => `${p.name} ${p.score}`).join(' · ')})
                  </span>
                )}
              </div>
            )}
          </div>
          <button className="link" onClick={onBack}>← Back</button>
        </div>
      </div>

      <ScoreChart players={players} rounds={rounds} />

      <GameAnalytics players={players} rounds={rounds} participants={result?.participants} />

      <div className="actions">
        <button className="primary" onClick={onBack}>Back to History</button>
      </div>
    </div>
  )
}
