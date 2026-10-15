import { Fragment, lazy, Suspense, useMemo } from 'react'
import { goBack, navigate, pathOf, useLocation } from '../../../shared/router'
import { Handshake, Trophy } from 'lucide-react'
import { useGameData } from '../lib/gameData'
import { usePaged } from '../hooks/usePaged'
import { onlineWinnerNames, isOnlineWinner } from '../utils/winners'
import { CardTypeIcon } from '../utils/gameIcons'
import GameAnalytics from './GameAnalytics'
import ShowMore from './ShowMore'

const NONE = []
// The chart library loads with the first game opened, not with the list.
const ScoreChart = lazy(() => import('./ScoreChart'))

// ─── Detail view ─────────────────────────────────────────────────────────────

// `detail`/`result` are the game's ჩაწერა rows, already built by gameData
// (players keyed by profile id); a game without round details has no detail.
function OnlineGameDetail({ game, detail, result, onBack }) {
  // seat-ordered players for the table (includes original score for final row)
  const seatPlayers = [...game.players].sort((a, b) => a.seat - b.seat)
  const roundDetails = game.roundDetails || []

  // Cumulative totals for the breakdown table
  const cumulatives = useMemo(() => {
    const running = {}
    seatPlayers.forEach(p => { running[p.seat] = 0 })
    return roundDetails.map(rd => {
      seatPlayers.forEach(p => { running[p.seat] += rd.scores?.[p.seat] ?? 0 })
      return { ...running }
    })
  }, [game])

  const date = new Date(game.playedAt).toLocaleString()

  return (
    <div>
      {/* Header */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h2 style={{ margin: '0 0 4px' }}>Online Game Details</h2>
            <div style={{ color: 'var(--muted)', fontSize: 13 }}>{date}</div>
            <div style={{ marginTop: 6 }}>
              {onlineWinnerNames(game).length > 1
                ? <><Handshake size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Tie — Winners:</>
                : 'Winner:'}{' '}
              <strong>{onlineWinnerNames(game).join(' & ') || game.winner?.name}</strong>
              <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 8 }}>
                ({seatPlayers.map(p => `${p.name} (${p.score > 0 ? '+' : ''}${p.score})`).join(' · ')})
              </span>
            </div>
          </div>
          <button className="link" onClick={onBack}>← Back</button>
        </div>
      </div>

      {detail && (
        <>
          {/* Score Progression chart */}
          <Suspense fallback={null}><ScoreChart players={detail.players} rounds={detail.rounds} /></Suspense>

          {/* Score by Type + Card Collection + Awards */}
          <GameAnalytics players={detail.players} rounds={detail.rounds} participants={result?.participants} />
        </>
      )}

      {/* Round-by-round breakdown table */}
      {roundDetails.length > 0 && (
        <div className="card">
          <h2>Round Breakdown</h2>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 480 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)' }}>
                  <th style={thStyle}>Rnd</th>
                  <th style={thStyle}>Type</th>
                  {seatPlayers.map(p => (
                    <th key={p.seat} style={{ ...thStyle, color: isOnlineWinner(game, p.name) ? 'var(--accent-good)' : 'var(--text)' }}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roundDetails.map((rd, i) => {
                  const cum = cumulatives[i]
                  return (
                    <Fragment key={i}>
                      <tr style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={tdStyle}>{rd.round}</td>
                        <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <CardTypeIcon code={rd.gameType} size={12} /> {rd.gameType}
                        </td>
                        {seatPlayers.map(p => {
                          const score = rd.scores?.[p.seat] ?? 0
                          return (
                            <td key={p.seat} style={{ ...tdStyle, fontWeight: 600, color: score > 0 ? 'var(--accent-good)' : score < 0 ? 'var(--accent-bad)' : 'var(--muted)' }}>
                              {score > 0 ? '+' : ''}{score}
                            </td>
                          )
                        })}
                      </tr>
                      <tr style={{ borderBottom: '2px solid var(--line)', background: 'var(--cell-bg)' }}>
                        <td style={{ ...tdStyle, color: 'var(--muted)', fontSize: 11 }} colSpan={2}>Σ after round {rd.round}</td>
                        {seatPlayers.map(p => (
                          <td key={p.seat} style={{ ...tdStyle, fontWeight: 700 }}>{cum[p.seat]}</td>
                        ))}
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--line)', background: 'var(--cell-bg)' }}>
                  <td style={{ ...tdStyle, fontWeight: 700 }} colSpan={2}>Final</td>
                  {seatPlayers.map(p => (
                    <td key={p.seat} style={{ ...tdStyle, fontWeight: 700, color: isOnlineWinner(game, p.name) ? 'var(--accent-good)' : 'var(--text)' }}>
                      {p.score > 0 ? '+' : ''}{p.score}
                      {isOnlineWinner(game, p.name) && <Trophy size={12} style={{ verticalAlign: '-1px', marginLeft: 4, color: 'var(--accent-gold)' }} />}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      <div className="actions">
        <button className="primary" onClick={onBack}>Back to Online Games</button>
      </div>
    </div>
  )
}

const thStyle = { padding: '8px 10px', textAlign: 'left', fontWeight: 700, fontSize: 12, color: 'var(--text)' }
const tdStyle = { padding: '7px 10px', textAlign: 'left' }

// ─── List view ────────────────────────────────────────────────────────────────

export default function OnlineHistoryTab() {
  const { data, loading, error } = useGameData()
  const games = data?.online.games ?? NONE
  // A game opens at /score/history/online/<id>.
  const { segments } = useLocation('/score')
  const selectedId = segments[1] === 'online' ? segments[2] : null
  const selectedGame = selectedId ? games.find(g => String(g.id) === selectedId) || null : null
  const setSelectedGame = g => (g
    ? navigate(pathOf('/score/history/online', g.id))
    : goBack('/score/history/online'))
  const { visible, remaining, showMore } = usePaged(games)
  const rowsById = useMemo(() => {
    const m = new Map()
    data?.online.results.forEach(r => m.set(r.id, { result: r }))
    data?.online.details.forEach(d => { const row = m.get(d.game_result_id); if (row) row.detail = d })
    return m
  }, [data])

  if (selectedGame) {
    const rows = rowsById.get(selectedGame.id) || {}
    return <OnlineGameDetail game={selectedGame} detail={rows.detail} result={rows.result} onBack={() => setSelectedGame(null)} />
  }

  if (loading && !data) return <p style={{ color: 'var(--muted)', padding: '8px 0' }}>Loading online games…</p>
  if (!data)   return <p style={{ color: 'var(--accent-bad)', padding: '8px 0' }}>Failed to load: {error}</p>
  if (!games.length) return <p style={{ color: 'var(--muted)', padding: '8px 0' }}>No online games recorded yet.</p>

  return (
    <>
    <div className="table">
      <div className="thead">
        <div className="tr history-tr">
          <div className="th">Date</div>
          <div className="th">Winner</div>
          <div className="th">Players &amp; Scores</div>
          <div className="th"></div>
        </div>
      </div>
      <div className="tbody">
        {visible.map(g => (
          <div key={g.id} className="tr history-tr">
            <div className="td">{new Date(g.playedAt).toLocaleDateString()}</div>
            <div className="td bold">
              {onlineWinnerNames(g).length > 1 && <Handshake size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />}
              {onlineWinnerNames(g).join(' & ') || g.winner?.name}
            </div>
            <div className="td">
              {[...g.players].sort((a, b) => a.seat - b.seat)
                .map(p => `${p.name} (${p.score > 0 ? '+' : ''}${p.score})`).join(', ')}
            </div>
            <div className="td center">
              <button
                onClick={() => setSelectedGame(g)}
                style={{ background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontWeight: 600, fontSize: 13, padding: 0 }}
              >
                Details
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
    <ShowMore remaining={remaining} onClick={showMore} />
    </>
  )
}
