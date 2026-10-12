import { useMemo, useState } from 'react'
import { Swords, Trophy } from 'lucide-react'
import { computeComparison } from '../utils/analytics'

const MAX_SELECT = 4

// players: [{ id, name }] roster from Global Analytics (id = stable player UUID)
export default function ComparePlayersPage({ players, details, results, onlineGames = [], uuidToOnlineName = {}, onBack }) {
  const [selectedIds, setSelectedIds] = useState([])

  const toggle = id => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length >= MAX_SELECT) return prev
      return [...prev, id]
    })
  }

  // Keep selection order stable so the matrix/table read predictably.
  const selected = useMemo(
    () => selectedIds.map(id => {
      const p = players.find(x => x.id === id)
      return { id, name: p?.name ?? id, onlineName: uuidToOnlineName[id] }
    }),
    [selectedIds, players, uuidToOnlineName]
  )

  const cmp = useMemo(
    () => (selected.length >= 2 ? computeComparison(selected, details, results, onlineGames) : null),
    [selected, details, results, onlineGames]
  )

  const nameById = useMemo(() => {
    const m = {}
    selected.forEach(s => { m[s.id] = s.name })
    return m
  }, [selected])

  const isPair = selected.length === 2

  return (
    <div>
      {/* Header */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Swords size={17} /> Compare Players</h2>
          <button className="link" onClick={onBack}>← Analytics</button>
        </div>
        <p style={{ color: 'var(--muted)', margin: '8px 0 0', fontSize: 13 }}>
          Select 2–4 players to see their head-to-head record across games they all played together.
        </p>
      </div>

      {/* Player selector */}
      <div className="card">
        <h2>Players ({selected.length}/{MAX_SELECT})</h2>
        <div className="compare-chips">
          {players.map(p => {
            const active = selectedIds.includes(p.id)
            const atMax = !active && selectedIds.length >= MAX_SELECT
            return (
              <button
                key={p.id}
                className={`compare-chip ${active ? 'selected' : ''}`}
                onClick={() => toggle(p.id)}
                disabled={atMax}
              >
                {active ? '✓ ' : ''}{p.name}
              </button>
            )
          })}
        </div>
        {selected.length < 2 && (
          <p style={{ color: 'var(--muted)', marginTop: 12, fontSize: 13 }}>
            Pick at least 2 players to compare.
          </p>
        )}
      </div>

      {cmp && cmp.totalShared === 0 && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            No shared games yet — {selected.map(s => s.name).join(', ')} haven’t all played in the same game.
          </p>
        </div>
      )}

      {cmp && cmp.totalShared > 0 && (
        <>
          {/* Head-to-head summary */}
          <div className="card">
            <h2>Head to Head</h2>
            <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 13 }}>
              {cmp.totalShared} shared game{cmp.totalShared !== 1 ? 's' : ''}
              {' · '}{cmp.localShared} local · {cmp.onlineShared} online
              {!cmp.allHaveOnline && ' (online skipped — not all selected players have an online name)'}
            </p>

            {isPair ? (
              <PairRecord cmp={cmp} a={selected[0]} b={selected[1]} />
            ) : (
              <H2HMatrix selected={selected} h2h={cmp.h2h} nameById={nameById} />
            )}
          </div>

          {/* Wins / Games / Win% table */}
          <div className="card">
            <h2>Record (Shared Games)</h2>
            <div className="table">
              <div className="thead">
                <div className="tr compare-tr">
                  <div className="th">Player</div>
                  <div className="th center">All Wins</div>
                  <div className="th center">All Games</div>
                  <div className="th center">Win%</div>
                </div>
              </div>
              <div className="tbody">
                {cmp.rows.map((r, i) => (
                  <div key={r.id} className={`tr compare-tr ${i === 0 ? 'leader-row' : ''}`}>
                    <div className="td bold">
                      {i === 0 && <Trophy size={12} style={{ verticalAlign: '-1px', marginRight: 4, color: 'var(--accent-gold)' }} />}
                      {r.name}
                    </div>
                    <div className="td center bold">{r.wins}</div>
                    <div className="td center">{r.games}</div>
                    <div className="td center">{r.winPct === null ? '—' : `${r.winPct.toFixed(0)}%`}</div>
                  </div>
                ))}
              </div>
            </div>
            <p style={{ color: 'var(--muted)', margin: '10px 0 0', fontSize: 12 }}>
              Wins counted across local + online games every selected player played in.
            </p>
          </div>
        </>
      )}

      <div className="actions">
        <button className="primary" onClick={onBack}>Back to Analytics</button>
      </div>
    </div>
  )
}

// Two-player head-to-head record. Headline = actual game wins each player has in
// their shared games (won't sum to games played — others win some). The secondary
// line shows who finished ahead of whom across all shared games.
function PairRecord({ cmp, a, b }) {
  const rowA = cmp.rows.find(r => r.id === a.id) || { wins: 0 }
  const rowB = cmp.rows.find(r => r.id === b.id) || { wins: 0 }
  const aWins = rowA.wins
  const bWins = rowB.wins
  const others = cmp.totalShared - aWins - bWins

  const aAhead = cmp.h2h[a.id]?.[b.id] ?? 0
  const bAhead = cmp.h2h[b.id]?.[a.id] ?? 0

  return (
    <div className="h2h-pair">
      <div className="h2h-side">
        <div className="h2h-name">{a.name}</div>
        <div className={`h2h-score ${aWins > bWins ? 'pos' : ''}`}>{aWins}</div>
        <div className="h2h-sub">win{aWins !== 1 ? 's' : ''}</div>
      </div>
      <div className="h2h-dash">–</div>
      <div className="h2h-side">
        <div className="h2h-name">{b.name}</div>
        <div className={`h2h-score ${bWins > aWins ? 'pos' : ''}`}>{bWins}</div>
        <div className="h2h-sub">win{bWins !== 1 ? 's' : ''}</div>
      </div>
      <div className="h2h-ties">
        {others > 0 && <>{others} game{others !== 1 ? 's' : ''} won by others · </>}
        finished ahead: {a.name} {aAhead}× · {b.name} {bAhead}×
      </div>
    </div>
  )
}

// 3–4 player pairwise grid: cell[row][col] = times row outscored col
function H2HMatrix({ selected, h2h, nameById }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div className="king-matrix">
        <div className="km-row km-header">
          <div className="km-cell km-label">Beat ↓ / vs →</div>
          {selected.map(s => (
            <div key={s.id} className="km-cell km-col-header">{nameById[s.id]}</div>
          ))}
        </div>
        {selected.map(rowP => {
          const row = h2h[rowP.id] || {}
          const maxInRow = Math.max(0, ...Object.values(row))
          return (
            <div key={rowP.id} className="km-row">
              <div className="km-cell km-row-header">{nameById[rowP.id]}</div>
              {selected.map(colP => {
                const isSelf = rowP.id === colP.id
                const count = row[colP.id] || 0
                let heatClass = 'heat-0'
                if (!isSelf && maxInRow > 0) {
                  const ratio = count / maxInRow
                  if (ratio >= 0.75) heatClass = 'heat-3'
                  else if (ratio >= 0.5) heatClass = 'heat-2'
                  else if (ratio >= 0.25) heatClass = 'heat-1'
                }
                return (
                  <div key={colP.id} className={`km-cell km-data ${isSelf ? 'km-self' : heatClass}`}>
                    {isSelf ? '—' : count}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}
