import { useMemo, useState } from 'react'
import { usePlayers } from '../hooks/usePlayers'
import { useGameResults } from '../hooks/useGameResults'
import { useAllGameDetails } from '../hooks/useAllGameDetails'
import TrophyIcon from './TrophyIcon'
import AchievementBadges from './AchievementBadges'
import { computeAllLifetimeAchievements } from '../utils/achievements'
import { isWinnerOf, isChampionName } from '../utils/winners'

export default function PlayersPage({ onBack, currentChampion }) {
  const { players, loading, addPlayer, deletePlayer } = usePlayers()
  const { results, loading: resultsLoading } = useGameResults()
  const { details: allDetails } = useAllGameDetails()
  const [name, setName] = useState('')
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(null) // player object to confirm

  const stats = useMemo(() => {
    const map = {}
    players.forEach((p) => { map[p.name] = { games: 0, wins: 0, totalScore: 0 } })
    results.forEach((r) => {
      r.participants.forEach((participant) => {
        if (!map[participant.name]) return
        map[participant.name].games++
        map[participant.name].totalScore += participant.score
        if (isWinnerOf(r, participant.name)) map[participant.name].wins++
      })
    })
    return map
  }, [players, results])

  const lifetimeAchievements = useMemo(
    () => computeAllLifetimeAchievements(allDetails, results),
    [allDetails, results]
  )

  async function handleAdd(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    const error = await addPlayer(name)
    setSaving(false)
    if (error) { setErr(error); return }
    setName('')
    setErr(null)
  }

  return (
    <div className="card">
      <h2>Manage Players</h2>
      <form onSubmit={handleAdd} className="row">
        <input
          value={name}
          onChange={(e) => { setName(e.target.value); setErr(null) }}
          placeholder="Player name"
          type="text"
          style={{ flex: 1, fontSize: 16, minHeight: 44, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--line-strong)', background: 'var(--input-bg)', color: 'var(--text)' }}
        />
        <button className="primary" disabled={saving || !name.trim()}>Add</button>
      </form>
      {err && <div className="validation" style={{ marginTop: 8 }}>{err}</div>}

      {loading || resultsLoading ? (
        <p style={{ color: 'var(--muted)', marginTop: 12 }}>Loading...</p>
      ) : players.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 12 }}>No players yet. Add one above.</p>
      ) : (
        <ul className="player-list">
          {players.map((p) => {
            const s = stats[p.name]
            const winRate = s && s.games > 0 ? Math.round((s.wins / s.games) * 100) : null
            const avgScore = s && s.games > 0 ? Math.round(s.totalScore / s.games) : null
            return (
              <li key={p.id} className="player-list-item">
                <div className="player-info">
                  <span className="player-name-label" style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    {p.name}
                    {isChampionName(currentChampion, p.name) && <TrophyIcon size={16} color="#d4a017" />}
                  </span>
                  {s && s.games > 0 ? (
                    <span className="player-stats">
                      {s.games} games · {s.wins} wins · {winRate}% win rate · avg {avgScore > 0 ? '+' : ''}{avgScore}
                    </span>
                  ) : (
                    <span className="player-stats">No games yet</span>
                  )}
                  <AchievementBadges achievements={lifetimeAchievements[p.name] || {}} />
                </div>
                <button className="link" style={{ color: '#dc2626', alignSelf: 'flex-start', marginTop: 2 }} onClick={() => setConfirmDelete(p)}>Remove</button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="actions">
        <button className="primary" onClick={onBack}>Back to Game</button>
      </div>

      {confirmDelete && (
        <div className="modal-overlay" onClick={() => setConfirmDelete(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Remove Player</h3>
            <p>Remove <strong>{confirmDelete.name}</strong>? This won't delete their game history.</p>
            <div className="modal-actions">
              <button className="link" onClick={() => setConfirmDelete(null)}>Cancel</button>
              <button
                className="primary"
                style={{ background: '#dc2626', borderColor: '#dc2626' }}
                onClick={() => { deletePlayer(confirmDelete.id); setConfirmDelete(null) }}
              >
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
