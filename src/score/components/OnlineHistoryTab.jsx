import { Fragment, useMemo, useState } from 'react'
import { Handshake, Trophy } from 'lucide-react'
import { useOnlineGames } from '../hooks/useOnlineData'
import { GAME_TYPES } from '../constants/gameTypes'
import { onlineWinnerNames, isOnlineWinner } from '../utils/winners'
import { CardTypeIcon } from '../utils/gameIcons'
import ScoreChart from './ScoreChart'
import GameAnalytics from './GameAnalytics'

// Convert online seat-based format to the internal {id, name} / UUID-keyed format
// that ScoreChart and GameAnalytics expect. We use String(seat) as the id.
function convertOnlineGame(game) {
  const players = [...game.players]
    .sort((a, b) => a.seat - b.seat)
    .map(p => ({ id: String(p.seat), name: p.name }))

  const rounds = (game.roundDetails || []).map(rd => {
    const scores = {}
    players.forEach(p => { scores[p.id] = rd.scores?.[+p.id] ?? 0 })

    const type = GAME_TYPES.find(t => t.code === rd.gameType)
    const countsByPlayerId = {}

    if (type?.kind === 'count') {
      players.forEach(p => {
        const seat = +p.id
        switch (rd.gameType) {
          case 'Q':  countsByPlayerId[p.id] = rd.queensTaken?.[seat] ?? 0; break
          case 'J':  countsByPlayerId[p.id] = rd.jacksTaken?.[seat]  ?? 0; break
          case 'H':  countsByPlayerId[p.id] = rd.heartsTaken?.[seat] ?? 0; break
          case 'T':  countsByPlayerId[p.id] = rd.tricksTaken?.[seat] ?? 0; break
          case 'L2': {
            const l2 = {}
            ;(rd.trickWinners || []).slice(-2).forEach(s => { l2[s] = (l2[s] || 0) + 1 })
            countsByPlayerId[p.id] = l2[seat] ?? 0
            break
          }
          default:   countsByPlayerId[p.id] = rd.tricksTaken?.[seat] ?? 0 // P1/P2/P3
        }
      })
    }

    return {
      gameTypeCode: rd.gameType,
      scores,
      ...(type?.kind === 'count' && { countsByPlayerId }),
      ...(type?.kind === 'single' && {
        singleTargetPlayerId: rd.kingOfHeartsTakenBy != null ? String(rd.kingOfHeartsTakenBy) : null,
      }),
      leaderPlayerId: String(rd.leaderSeat),
    }
  })

  const participants = game.players.map(p => ({ name: p.name, score: p.score }))
  return { players, rounds, participants }
}

// ─── Detail view ─────────────────────────────────────────────────────────────

function OnlineGameDetail({ game, onBack }) {
  const { players, rounds, participants } = useMemo(() => convertOnlineGame(game), [game])

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

      {/* Score Progression chart */}
      <ScoreChart players={players} rounds={rounds} />

      {/* Score by Type + Card Collection + Awards */}
      <GameAnalytics players={players} rounds={rounds} participants={participants} />

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
  const { games, loading, error } = useOnlineGames(200)
  const [selectedGame, setSelectedGame] = useState(null)

  if (selectedGame) {
    return <OnlineGameDetail game={selectedGame} onBack={() => setSelectedGame(null)} />
  }

  if (loading) return <p style={{ color: 'var(--muted)', padding: '8px 0' }}>Loading online games…</p>
  if (error)   return <p style={{ color: 'var(--accent-bad)', padding: '8px 0' }}>Failed to load: {error}</p>
  if (!games.length) return <p style={{ color: 'var(--muted)', padding: '8px 0' }}>No online games recorded yet.</p>

  return (
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
        {games.map(g => (
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
  )
}
