import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { Swords, Medal, Globe } from 'lucide-react'
import { computeGlobalStats, getGlobalAwards, TYPE_ROWS, computeKingMatrix, computeTypeEfficiency } from '../utils/analytics'
import { isOnlineWinner } from '../utils/winners'
import { CardTypeIcon, AwardIcon } from '../utils/gameIcons'
import ComparePlayersPage from './ComparePlayersPage'

import { PLAYER_COLORS as COLORS } from '../App'
const TYPE_CODES = ['K', 'Q', 'J', 'H', 'L2', 'T', 'P1', 'P2', 'P3']

function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

// onlineGames: season-filtered array from WinnersPage (already sliced to current season)
export default function GlobalAnalyticsPage({ details, results, supabasePlayers = [], onlineGames = [], onBack }) {
  const [view, setView] = useState('main') // 'main' | 'compare'
  const playerMap = useMemo(() => computeGlobalStats(details, results), [details, results])

  // Compute per-player online stats from the (season-filtered) game list
  const onlineMap = useMemo(() => {
    const m = {}
    onlineGames.forEach(g => {
      const ps = g.players || []
      ps.forEach(p => {
        if (!m[p.name]) m[p.name] = { gamesPlayed: 0, wins: 0, seconds: 0, totalScore: 0 }
        m[p.name].gamesPlayed++
        m[p.name].totalScore += p.score ?? 0
        if (isOnlineWinner(g, p.name)) m[p.name].wins++
      })
      // Second place = 2nd-highest score in the game
      const ranking = [...ps].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      if (ranking.length >= 2 && m[ranking[1].name]) m[ranking[1].name].seconds++
    })
    return m
  }, [onlineGames])

  // UUID → online_name from the players table (set manually in Supabase dashboard)
  const uuidToOnlineName = useMemo(() => {
    const m = {}
    supabasePlayers.forEach(p => { if (p.online_name) m[p.id] = p.online_name })
    return m
  }, [supabasePlayers])
  const awards = useMemo(() => getGlobalAwards(playerMap), [playerMap])
  const players = useMemo(
    () => Object.entries(playerMap)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => {
        const aWins = a.wins + (onlineMap[uuidToOnlineName[a.id]]?.wins ?? 0)
        const bWins = b.wins + (onlineMap[uuidToOnlineName[b.id]]?.wins ?? 0)
        return bWins - aWins
      }),
    [playerMap, onlineMap, uuidToOnlineName]
  )
  const kingMatrix = useMemo(() => computeKingMatrix(details), [details])
  const typeEfficiency = useMemo(() => computeTypeEfficiency(details), [details])

  const kingLeaders = useMemo(() => Object.keys(kingMatrix).sort(), [kingMatrix])
  const kingTargets = useMemo(() => {
    const targets = new Set()
    Object.values(kingMatrix).forEach(row => Object.keys(row).forEach(t => targets.add(t)))
    return [...targets].sort()
  }, [kingMatrix])

  const effPlayers = useMemo(() => Object.keys(typeEfficiency).sort(), [typeEfficiency])

  // Bar chart: total units collected per card type per player
  const unitBarData = useMemo(() => {
    return TYPE_ROWS.map(tr => {
      const point = { type: tr.label }
      players.forEach(p => { point[p.name] = p[tr.code] || 0 })
      return point
    })
  }, [players])

  // Bar chart: avg score per player
  const avgScoreData = useMemo(() => {
    return players.map(p => ({
      name: p.name,
      avg: p.gamesPlayed > 0 ? +(p.totalScore / p.gamesPlayed).toFixed(1) : 0,
    }))
  }, [players])

  if (players.length === 0) {
    return (
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Global Analytics</h2>
          <button className="link" onClick={onBack}>← Back</button>
        </div>
        <p style={{ color: 'var(--muted)', marginTop: 12 }}>
          No detailed game data yet. Play a game to start seeing analytics.
        </p>
        <div className="actions">
          <button className="primary" onClick={onBack}>Back to History</button>
        </div>
      </div>
    )
  }

  if (view === 'compare') {
    return (
      <ComparePlayersPage
        players={players}
        details={details}
        results={results}
        onlineGames={onlineGames}
        uuidToOnlineName={uuidToOnlineName}
        onBack={() => setView('main')}
      />
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Global Analytics</h2>
          <button className="link" onClick={onBack}>← Back</button>
        </div>
        <p style={{ color: 'var(--muted)', margin: '8px 0 0', fontSize: 13 }}>
          {details.length} recorded game{details.length !== 1 ? 's' : ''} · {players.length} player{players.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Compare entry point */}
      <div className="card compare-cta">
        <div>
          <strong>Compare Players</strong>
          <p style={{ color: 'var(--muted)', margin: '4px 0 0', fontSize: 13 }}>
            Head-to-head stats for 2–4 players across the games they shared.
          </p>
        </div>
        <button className="primary icon-btn" onClick={() => setView('compare')}><Swords size={14} /> Compare</button>
      </div>

      {/* Player Summary Table */}
      <div className="card">
        <h2>Player Summary</h2>
        <div className="table">
          <div className="thead">
            <div className="tr summary-tr">
              <div className="th">Player</div>
              <div className="th center online-col">All Wins</div>
              <div className="th center online-col"><Medal size={11} /> 2nd</div>
              <div className="th center">Games</div>
              <div className="th center">Wins</div>
              <div className="th center online-col"><Globe size={11} /> Games</div>
              <div className="th center online-col"><Globe size={11} /> Wins</div>
              <div className="th center online-col">Total Games</div>
              <div className="th center">Win%</div>
              <div className="th center online-col"><Globe size={11} /> Win%</div>
              <div className="th center online-col">Total%</div>
              <div className="th center">Avg Score</div>
              <div className="th center"><CardTypeIcon code="Q" size={11} /> Q</div>
              <div className="th center"><CardTypeIcon code="J" size={11} /> J</div>
              <div className="th center"><CardTypeIcon code="H" size={11} /> H</div>
              <div className="th center"><CardTypeIcon code="K" size={11} /> K</div>
              <div className="th center"><CardTypeIcon code="L2" size={11} /> L2</div>
              <div className="th center"><CardTypeIcon code="T" size={11} /> T</div>
              <div className="th center"><CardTypeIcon code="P" size={11} /> P</div>
            </div>
          </div>
          <div className="tbody">
            {players.map(p => {
              const avgScore = p.gamesPlayed > 0 ? (p.totalScore / p.gamesPlayed).toFixed(1) : '0'
              const plusTotal = p.P1 + p.P2 + p.P3
              const online = onlineMap[uuidToOnlineName[p.id]]
              const allWins    = p.wins + (online?.wins ?? 0)
              const allSeconds = (p.seconds ?? 0) + (online?.seconds ?? 0)
              const totalGames = p.gamesPlayed + (online?.gamesPlayed ?? 0)
              const winPct        = p.gamesPlayed > 0 ? ((p.wins / p.gamesPlayed) * 100).toFixed(0) : '—'
              const onlineWinPct  = online?.gamesPlayed > 0 ? ((online.wins / online.gamesPlayed) * 100).toFixed(0) : '—'
              const totalWinPct   = totalGames > 0 ? ((allWins / totalGames) * 100).toFixed(0) : '—'
              return (
                <div key={p.id} className="tr summary-tr">
                  <div className="td bold">{p.name}</div>
                  <div className="td center online-col bold">{allWins}</div>
                  <div className="td center online-col">{allSeconds}</div>
                  <div className="td center">{p.gamesPlayed}</div>
                  <div className="td center">{p.wins}</div>
                  <div className="td center online-col">{online ? online.gamesPlayed : '—'}</div>
                  <div className="td center online-col">{online ? online.wins : '—'}</div>
                  <div className="td center online-col">{totalGames}</div>
                  <div className="td center">{winPct}{winPct !== '—' ? '%' : ''}</div>
                  <div className="td center online-col">{onlineWinPct}{onlineWinPct !== '—' ? '%' : ''}</div>
                  <div className="td center online-col bold">{totalWinPct}{totalWinPct !== '—' ? '%' : ''}</div>
                  <div className={`td center ${+avgScore > 0 ? 'pos' : +avgScore < 0 ? 'neg' : ''}`}>{avgScore}</div>
                  <div className="td center">{p.Q}</div>
                  <div className="td center">{p.J}</div>
                  <div className="td center">{p.H}</div>
                  <div className="td center">{p.K}</div>
                  <div className="td center">{p.L2}</div>
                  <div className="td center">{p.T}</div>
                  <div className="td center">{plusTotal}</div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Hall of Fame */}
      <div className="card">
        <h2>Hall of Fame</h2>
        <div className="awards-grid">
          {awards.map((a, i) => (
            <div key={i} className="award-card">
              <div className="award-icon"><AwardIcon name={a.icon} /></div>
              <div className="award-title">{a.title}</div>
              <div className="award-player">{a.player}</div>
              <div className="award-value">{a.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Total Cards Collected chart */}
      <div className="card">
        <h2>Total Cards Collected (All Games)</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>
          Units collected per card type across every game.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={unitBarData} margin={{ top: 8, right: 16, left: 0, bottom: 70 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={getCssVar('--grid-stroke')} />
            <XAxis dataKey="type" tick={{ fontSize: 11, fill: getCssVar('--muted') }} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={{ fontSize: 11, fill: getCssVar('--muted') }} width={40} allowDecimals={false} />
            <Tooltip contentStyle={{ background: getCssVar('--tooltip-bg'), border: `2px solid ${getCssVar('--text')}`, borderRadius: 8, fontSize: 13 }} />
            <Legend wrapperStyle={{ fontSize: 13, paddingTop: 16 }} />
            {players.map((p, i) => (
              <Bar key={p.id} dataKey={p.name} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Average Score per Game chart */}
      <div className="card">
        <h2>Average Score per Game</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={avgScoreData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={getCssVar('--grid-stroke')} />
            <XAxis dataKey="name" tick={{ fontSize: 12, fill: getCssVar('--muted') }} />
            <YAxis tick={{ fontSize: 11, fill: getCssVar('--muted') }} width={44} />
            <ReferenceLine y={0} stroke={getCssVar('--text')} strokeDasharray="4 2" />
            <Tooltip
              contentStyle={{ background: getCssVar('--tooltip-bg'), border: `2px solid ${getCssVar('--text')}`, borderRadius: 8, fontSize: 13 }}
              formatter={v => [v, 'Avg Score']}
            />
            <Bar dataKey="avg" name="Avg Score" radius={[3, 3, 0, 0]}>
              {avgScoreData.map((entry, i) => (
                <Cell key={i} fill={entry.avg >= 0 ? '#059669' : '#dc2626'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* King Targeting Matrix */}
      {kingLeaders.length > 0 && (
        <div className="card">
          <h2>King Targeting Matrix</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>
            How many times each player sent the King to another player (across all games).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <div className="king-matrix">
              <div className="km-row km-header">
                <div className="km-cell km-label">Dealer ↓ / Target →</div>
                {kingTargets.map(t => (
                  <div key={t} className="km-cell km-col-header">{t}</div>
                ))}
              </div>
              {kingLeaders.map(leader => {
                const row = kingMatrix[leader] || {}
                const maxInRow = Math.max(0, ...Object.values(row))
                return (
                  <div key={leader} className="km-row">
                    <div className="km-cell km-row-header">{leader}</div>
                    {kingTargets.map(target => {
                      const count = row[target] || 0
                      const isSelf = leader === target
                      let heatClass = 'heat-0'
                      if (!isSelf && maxInRow > 0) {
                        const ratio = count / maxInRow
                        if (ratio >= 0.75) heatClass = 'heat-3'
                        else if (ratio >= 0.5) heatClass = 'heat-2'
                        else if (ratio >= 0.25) heatClass = 'heat-1'
                      }
                      return (
                        <div key={target} className={`km-cell km-data ${isSelf ? 'km-self' : heatClass}`}>
                          {isSelf ? '—' : count || 0}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Type Efficiency Table */}
      {effPlayers.length > 0 && (
        <div className="card">
          <h2>Score Efficiency by Type</h2>
          <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>
            Average score per round for each card type (across all games played in that round).
          </p>
          <div style={{ overflowX: 'auto' }}>
            <div className="eff-table">
              <div className="eff-row eff-header">
                <div className="eff-cell eff-name-col">Player</div>
                {TYPE_CODES.map(code => (
                  <div key={code} className="eff-cell eff-type-col">{code}</div>
                ))}
              </div>
              {effPlayers.map(name => {
                const data = typeEfficiency[name] || {}
                return (
                  <div key={name} className="eff-row">
                    <div className="eff-cell eff-name-col bold">{name}</div>
                    {TYPE_CODES.map(code => {
                      const val = data[code]
                      if (val === null || val === undefined) return <div key={code} className="eff-cell eff-type-col">—</div>
                      const cls = val > 0 ? 'eff-pos' : val < 0 ? 'eff-neg' : ''
                      return (
                        <div key={code} className={`eff-cell eff-type-col ${cls}`}>
                          {val > 0 ? '+' : ''}{val.toFixed(1)}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* Category Leaderboards */}
      <div className="card">
        <h2>Category Leaderboards</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>
          All-time totals per card type, ranked.
        </p>
        <div className="leaderboard-grid">
          {TYPE_ROWS.map(tr => {
            const sorted = [...players].sort((a, b) => (b[tr.code] || 0) - (a[tr.code] || 0))
            return (
              <div key={tr.code} className="leaderboard-card">
                <div className="leaderboard-title"><CardTypeIcon code={tr.code} size={12} /> {tr.label}</div>
                {sorted.map((p, i) => (
                  <div key={p.id} className={`leaderboard-row ${i === 0 ? 'leader' : ''}`}>
                    <span className="lb-rank">{i + 1}.</span>
                    <span className="lb-name">{p.name}</span>
                    <span className="lb-val">{p[tr.code] || 0}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-player breakdown cards */}
      <div className="card">
        <h2>Per-Player Breakdown</h2>
        <div className="player-breakdown-grid">
          {players.map((p, pi) => {
            const plusTotal = p.P1 + p.P2 + p.P3
            const winPct = p.gamesPlayed > 0 ? ((p.wins / p.gamesPlayed) * 100).toFixed(0) : 0
            const avgScore = p.gamesPlayed > 0 ? (p.totalScore / p.gamesPlayed).toFixed(1) : '0'
            return (
              <div key={p.id} className="player-breakdown-card" style={{ borderColor: COLORS[pi % COLORS.length] }}>
                <div className="pb-header" style={{ background: COLORS[pi % COLORS.length] }}>
                  <span className="pb-name">{p.name}</span>
                  <span className="pb-record">{p.wins}W / {p.gamesPlayed - p.wins}L</span>
                </div>
                <div className="pb-body">
                  <div className="pb-stat"><span>Win Rate</span><strong>{winPct}%</strong></div>
                  <div className="pb-stat"><span>Avg Score</span><strong className={+avgScore >= 0 ? 'pos' : 'neg'}>{avgScore}</strong></div>
                  <div className="pb-stat"><span><CardTypeIcon code="Q" /> Queens</span><strong>{p.Q}</strong></div>
                  <div className="pb-stat"><span><CardTypeIcon code="J" /> Jacks</span><strong>{p.J}</strong></div>
                  <div className="pb-stat"><span><CardTypeIcon code="H" /> Hearts</span><strong>{p.H}</strong></div>
                  <div className="pb-stat"><span><CardTypeIcon code="K" /> Kings</span><strong>{p.K}</strong></div>
                  <div className="pb-stat"><span><CardTypeIcon code="L2" /> Last 2</span><strong>{p.L2}</strong></div>
                  <div className="pb-stat"><span><CardTypeIcon code="T" /> Bad Tricks</span><strong>{p.T}</strong></div>
                  <div className="pb-stat"><span><CardTypeIcon code="P" /> Plus Tricks</span><strong className="pos">{plusTotal}</strong></div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="actions">
        <button className="primary" onClick={onBack}>Back to History</button>
      </div>
    </div>
  )
}
