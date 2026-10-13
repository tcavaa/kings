import { useMemo } from 'react'
import { usePlayers } from '../hooks/usePlayers'
import { useGameData, gamesOfType } from '../lib/gameData'
import TrophyIcon from './TrophyIcon'
import TypeFilter, { useTypeFilter } from './TypeFilter'
import AchievementBadges from './AchievementBadges'
import { computeAllLifetimeAchievements } from '../utils/achievements'
import { isChampionName } from '../utils/winners'
import { standingsOf } from '../utils/seasonStandings'

export default function PlayersPage({ onBack, currentChampion }) {
  // One list with King Online. Players are added and removed in /admin.
  const { players, loading } = usePlayers()
  const { data, loading: resultsLoading } = useGameData()
  const [type, setType] = useTypeFilter()
  const { results, details: allDetails } = useMemo(() => gamesOfType(data, type), [data, type])

  // { [name]: { games, wins, totalScore } } — tie-aware, like the season tables.
  const stats = useMemo(
    () => Object.fromEntries(standingsOf(results).map(r => [r.name, r])),
    [results]
  )

  const lifetimeAchievements = useMemo(
    () => computeAllLifetimeAchievements(allDetails, results),
    [allDetails, results]
  )

  return (
    <div className="card">
      <h2>Players</h2>
      <TypeFilter value={type} onChange={setType} />

      {loading || resultsLoading ? (
        <p style={{ color: 'var(--muted)', marginTop: 12 }}>Loading...</p>
      ) : players.length === 0 ? (
        <p style={{ color: 'var(--muted)', marginTop: 12 }}>No players yet.</p>
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
              </li>
            )
          })}
        </ul>
      )}

      <div className="actions">
        <button className="primary" onClick={onBack}>Back to Game</button>
      </div>

    </div>
  )
}
