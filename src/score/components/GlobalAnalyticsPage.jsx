import { useMemo } from 'react'
import { Swords, Medal } from 'lucide-react'
import { computeGlobalStats, getGlobalAwards, TYPE_ROWS } from '../utils/analytics'
import { CardTypeIcon } from '../utils/gameIcons'
import ComparePlayersPage from './ComparePlayersPage'
import AwardsGrid from './AwardsGrid'
import { PLAYER_COLORS as COLORS } from '../constants/colors'
import { goBack, navigate, useLocation } from '../../../shared/router'

// details/results: the season's games of the type picked in `filter` — King
// Online's and the ones recorded here are counted the same way, per player.
export default function GlobalAnalyticsPage({ details, results, filter = null, onBack }) {
  // /score/stats, and /score/stats/compare for the head-to-head.
  const { segments } = useLocation('/score')
  const view = segments[1] === 'compare' ? 'compare' : 'main'
  const setView = v => (v === 'compare' ? navigate('/score/stats/compare') : goBack('/score/stats'))
  // Players taken off the player list (no King Online name) keep their old
  // games, under `guest:` ids, but aren't listed or ranked any more.
  const playerMap = useMemo(() => Object.fromEntries(
    Object.entries(computeGlobalStats(details, results)).filter(([id]) => !id.startsWith('guest:'))
  ), [details, results])
  const awards = useMemo(() => getGlobalAwards(playerMap), [playerMap])
  const players = useMemo(
    () => Object.entries(playerMap)
      .map(([id, data]) => ({ id, ...data }))
      .sort((a, b) => b.wins - a.wins),
    [playerMap]
  )
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
