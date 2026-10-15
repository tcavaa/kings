import { useMemo } from 'react'
import { computeGameStats, getGameAwards, TYPE_ROWS } from '../utils/analytics'
import { computePerGameAchievements, countCodes } from '../utils/achievements'
import { CardTypeIcon } from '../utils/gameIcons'
import AchievementBadges from './AchievementBadges'
import AwardsGrid from './AwardsGrid'

export default function GameAnalytics({ players, rounds, participants }) {
  const stats = useMemo(() => computeGameStats(players, rounds), [players, rounds])
  const awards = useMemo(() => getGameAwards(players, stats, participants), [players, stats, participants])
  const perGameAchievements = useMemo(() => computePerGameAchievements(players, rounds), [players, rounds])

  const playerAchievementMaps = useMemo(() => {
    const maps = {}
    players.forEach(p => {
      const codes = perGameAchievements[p.id] || []
      if (codes.length) maps[p.id] = countCodes(codes)
    })
    return maps
  }, [players, perGameAchievements])

  return (
    <>
      {/* Card Collection breakdown table */}
      <div className="card">
        <h2>აღებული კარტები</h2>
        <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13 }}>
          რამდენი კარტი აიღო თითოეულმა მოთამაშემ ყველა რაუნდში. მუქი = ყველაზე მეტი ამ რიგში.
        </p>
        <div className="table">
          <div className="thead">
            <div className="tr analytics-tr" style={{ '--ac': players.length }}>
              <div className="th">ტიპი</div>
              {players.map(p => <div key={p.id} className="th center">{p.name}</div>)}
            </div>
          </div>
          <div className="tbody">
            {TYPE_ROWS.map(tr => {
              const values = players.map(p => stats[p.id]?.[tr.code] || 0)
              const maxVal = Math.max(...values)
              return (
                <div key={tr.code} className="tr analytics-tr" style={{ '--ac': players.length }}>
                  <div className="td"><CardTypeIcon code={tr.code} /> {tr.label}</div>
                  {players.map((p, i) => {
                    const val = stats[p.id]?.[tr.code] || 0
                    const isMax = val > 0 && val === maxVal
                    return (
                      <div
                        key={p.id}
                        className={`td center ${isMax ? 'bold analytics-max' : ''} ${val === 0 ? 'analytics-zero' : ''}`}
                      >
                        {val}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Game Awards */}
      <div className="card">
        <h2>თამაშის ჯილდოები</h2>
        <AwardsGrid awards={awards} emptyText="ჯილდოების მონაცემები არ არის." />
      </div>

      {/* Per-game Achievements */}
      {Object.keys(playerAchievementMaps).length > 0 && (
        <div className="card">
          <h2>მიღწევები</h2>
          <div className="game-achievements-grid">
            {players.map(p => {
              const achs = playerAchievementMaps[p.id]
              if (!achs) return null
              return (
                <div key={p.id} className="game-achievements-player">
                  <div className="game-achievements-player-name">{p.name}</div>
                  <AchievementBadges achievements={achs} />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
