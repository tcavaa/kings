import { useMemo } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, ReferenceLine, Cell,
} from 'recharts'
import { Swords, Medal } from 'lucide-react'
import { computeGlobalStats, getGlobalAwards, TYPE_ROWS, computeKingMatrix, computeTypeEfficiency } from '../utils/analytics'
import { CardTypeIcon } from '../utils/gameIcons'
import { useChartTheme } from '../utils/chartTheme'
import ComparePlayersPage from './ComparePlayersPage'
import AwardsGrid from './AwardsGrid'
import HeatMatrix from './HeatMatrix'
import { PLAYER_COLORS as COLORS } from '../constants/colors'
import { goBack, navigate, useLocation } from '../../../shared/router'

const TYPE_CODES = ['K', 'Q', 'J', 'H', 'L2', 'T', 'P1', 'P2', 'P3']

// details/results: the season's games of the type picked in `filter` — King
// Online's and the ones recorded here are counted the same way, per player.
export default function GlobalAnalyticsPage({ details, results, filter = null, onBack }) {
  // /score/stats, and /score/stats/compare for the head-to-head.
  const { segments } = useLocation('/score')
  const view = segments[1] === 'compare' ? 'compare' : 'main'
  const setView = v => (v === 'compare' ? navigate('/score/stats/compare') : goBack('/score/stats'))
  const chart = useChartTheme()
  // Players taken off the player list (no King Online name) keep their old
  // games, under `guest:` ids, but aren't listed or ranked any more.
  const playerMap = useMemo(() => Object.fromEntries(
    Object.entries(computeGlobalStats(details, results)).filter(([id]) => !id.startsWith('guest:'))
  ), [details, results])
  const guestNames = useMemo(() => new Set(details.flatMap(d =>
    (d.players || []).filter(p => String(p.id).startsWith('guest:')).map(p => p.name))
  ), [details])
  const awards = useMemo(() => getGlobalAwards(playerMap), [playerMap])
  const players = useMemo(
    () => Object.entries(playerMap)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.wins - a.wins),
    [playerMap]
  )
  const kingMatrix = useMemo(() => computeKingMatrix(details), [details])
  const typeEfficiency = useMemo(() => computeTypeEfficiency(details), [details])

  const kingLeaders = useMemo(() => Object.keys(kingMatrix).filter(n => !guestNames.has(n)).sort(), [kingMatrix, guestNames])
  const kingTargets = useMemo(() => {
    const targets = new Set()
    Object.values(kingMatrix).forEach(row => Object.keys(row).forEach(t => targets.add(t)))
    return [...targets].filter(n => !guestNames.has(n)).sort()
  }, [kingMatrix, guestNames])

  const effPlayers = useMemo(() => Object.keys(typeEfficiency).filter(n => !guestNames.has(n)).sort(), [typeEfficiency, guestNames])

  // Bar chart: total units collected per card type per player (one series
  // per player, by position, so equal names don't merge)
  const unitBarData = useMemo(() => {
    return TYPE_ROWS.map(tr => {
      const point = { type: tr.label }
      players.forEach((p, i) => { point[`s${i}`] = p[tr.code] || 0 })
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
        {filter}
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
        {filter}
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
              <div className="th center">Games</div>
              <div className="th center">Wins</div>
              <div className="th center"><Medal size={11} /> 2nd</div>
              <div className="th center">Win%</div>
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
              const winPct = p.gamesPlayed > 0 ? ((p.wins / p.gamesPlayed) * 100).toFixed(0) : '—'
              return (
                <div key={p.id} className="tr summary-tr">
                  <div className="td bold">{p.name}</div>
                  <div className="td center">{p.gamesPlayed}</div>
                  <div className="td center bold">{p.wins}</div>
                  <div className="td center">{p.seconds ?? 0}</div>
                  <div className="td center">{winPct}{winPct !== '—' ? '%' : ''}</div>
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
        <AwardsGrid awards={awards} />
      </div>

      {/* Total Cards Collected chart */}
      <div className="card">
        <h2>Total Cards Collected (All Games)</h2>
        <p style={{ margin: '0 0 12px', color: 'var(--muted)', fontSize: 13 }}>
          Units collected per card type across every game.
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={unitBarData} margin={{ top: 8, right: 16, left: 0, bottom: 70 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
            <XAxis dataKey="type" tick={chart.tick} angle={-35} textAnchor="end" interval={0} />
            <YAxis tick={chart.tick} width={40} allowDecimals={false} />
            <Tooltip contentStyle={chart.tooltipStyle} />
            <Legend wrapperStyle={{ fontSize: 13, paddingTop: 16 }} />
            {players.map((p, i) => (
              <Bar key={p.id} dataKey={`s${i}`} name={p.name} fill={COLORS[i % COLORS.length]} radius={[3, 3, 0, 0]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Average Score per Game chart */}
      <div className="card">
        <h2>Average Score per Game</h2>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={avgScoreData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
            <XAxis dataKey="name" tick={{ ...chart.tick, fontSize: 12 }} />
            <YAxis tick={chart.tick} width={44} />
            <ReferenceLine y={0} stroke={chart.text} strokeDasharray="4 2" />
            <Tooltip contentStyle={chart.tooltipStyle} formatter={v => [v, 'Avg Score']} />
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
          <HeatMatrix
            corner="Dealer ↓ / Target →"
            rows={kingLeaders.map(n => ({ key: n, label: n }))}
            cols={kingTargets.map(n => ({ key: n, label: n }))}
            countOf={(leader, target) => kingMatrix[leader]?.[target]}
          />
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
