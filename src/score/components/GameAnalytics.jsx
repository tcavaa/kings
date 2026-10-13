import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { computeGameStats, computeScoresByType, getGameAwards, TYPE_ROWS } from '../utils/analytics'
import { computePerGameAchievements } from '../utils/achievements'
import { CardTypeIcon } from '../utils/gameIcons'
import { useChartTheme } from '../utils/chartTheme'
import AchievementBadges from './AchievementBadges'
import AwardsGrid from './AwardsGrid'
import { PLAYER_COLORS as COLORS } from '../constants/colors'

export default function GameAnalytics({ players, rounds, participants }) {
  const chart = useChartTheme()
  const stats = useMemo(() => computeGameStats(players, rounds), [players, rounds])
  const scoresByType = useMemo(() => computeScoresByType(players, rounds), [players, rounds])
  const awards = useMemo(() => getGameAwards(players, stats, participants), [players, stats, participants])
  const perGameAchievements = useMemo(() => computePerGameAchievements(players, rounds), [players, rounds])

  const playerAchievementMaps = useMemo(() => {
    const maps = {}
    players.forEach(p => {
      const codes = perGameAchievements[p.id] || []
      if (!codes.length) return
      maps[p.id] = codes.reduce((acc, code) => {
        acc[code] = (acc[code] || 0) + 1
        return acc
      }, {})
    })
    return maps
  }, [players, perGameAchievements])

  // Bar chart: score contribution per game type per player (only non-zero
  // types). One series per sheet column, so equal names don't merge.
  const barData = useMemo(() => {
    return TYPE_ROWS.map(tr => {
      const point = { type: tr.label }
      let anyNonZero = false
      players.forEach((p, i) => {
        const score = scoresByType[p.id]?.[tr.code] || 0
        point[`s${i}`] = score
        if (score !== 0) anyNonZero = true
      })
      return anyNonZero ? point : null
    }).filter(Boolean)
  }, [players, scoresByType])

  return (
    <>
      {/* Score by Game Type bar chart */}
      <div className="card">
        <h2>Score by Game Type</h2>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={barData} margin={{ top: 8, right: 16, left: 0, bottom: 64 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
            <XAxis
              dataKey="type"
              tick={chart.tick}
              angle={-35}
              textAnchor="end"
              interval={0}
            />
            <YAxis tick={chart.tick} width={44} />
            <ReferenceLine y={0} stroke={chart.text} strokeDasharray="4 2" />
            <Tooltip contentStyle={chart.tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 13, paddingTop: 12 }} />
            {players.map((p, i) => (
              <Bar key={p.id} dataKey={`s${i}`} name={p.name} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Card Collection breakdown table */}
      <div className="card">
        <h2>Card Collection</h2>
        <p style={{ margin: '0 0 10px', color: 'var(--muted)', fontSize: 13 }}>
          How many of each card type each player collected across all rounds. Bold = most in that row.
        </p>
        <div className="table">
          <div className="thead">
            <div className="tr analytics-tr" style={{ '--ac': players.length }}>
              <div className="th">Type</div>
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
        <h2>Game Awards</h2>
        <AwardsGrid awards={awards} emptyText="No awards data available." />
      </div>

      {/* Per-game Achievements */}
      {Object.keys(playerAchievementMaps).length > 0 && (
        <div className="card">
          <h2>Achievements</h2>
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
