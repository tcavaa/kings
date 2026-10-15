import { useMemo, useState } from 'react'
import { Swords, Trophy } from 'lucide-react'
import { computeComparison } from '../utils/analytics'
import HeatMatrix from './HeatMatrix'

const MAX_SELECT = 4

// players: [{ id, name }] roster from Global Analytics (id = the player's profile id)
export default function ComparePlayersPage({ players, details, results, onBack }) {
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
      return { id, name: p?.name ?? id }
    }),
    [selectedIds, players]
  )

  const cmp = useMemo(
    () => (selected.length >= 2 ? computeComparison(selected, details, results) : null),
    [selected, details, results]
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
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Swords size={17} /> მოთამაშეების შედარება</h2>
          <button className="link" onClick={onBack}>← სტატისტიკა</button>
        </div>
        <p style={{ color: 'var(--muted)', margin: '8px 0 0', fontSize: 13 }}>
          აირჩიე 2–4 მოთამაშე და ნახე მათი პირისპირ შედეგები თამაშებში, სადაც ყველა ერთად თამაშობდა.
        </p>
      </div>

      {/* Player selector */}
      <div className="card">
        <h2>მოთამაშეები ({selected.length}/{MAX_SELECT})</h2>
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
            შესადარებლად აირჩიე მინიმუმ 2 მოთამაშე.
          </p>
        )}
      </div>

      {cmp && cmp.totalShared === 0 && (
        <div className="card">
          <p style={{ color: 'var(--muted)', margin: 0 }}>
            საერთო თამაშები ჯერ არ არის — {selected.map(s => s.name).join(', ')} ერთსა და იმავე თამაშში ჯერ არ უთამაშიათ.
          </p>
        </div>
      )}

      {cmp && cmp.totalShared > 0 && (
        <>
          {/* Head-to-head summary */}
          <div className="card">
            <h2>პირისპირ</h2>
            <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 13 }}>
              {cmp.totalShared} საერთო თამაში
              {' · '}{cmp.localShared} ლაივი · {cmp.onlineShared} ონლაინ
            </p>

            {isPair ? (
              <PairRecord cmp={cmp} a={selected[0]} b={selected[1]} />
            ) : (
              <H2HMatrix selected={selected} h2h={cmp.h2h} nameById={nameById} />
            )}
          </div>

          {/* Wins / Games / Win% table */}
          <div className="card">
            <h2>შედეგები (საერთო თამაშები)</h2>
            <div className="table">
              <div className="thead">
                <div className="tr compare-tr">
                  <div className="th">მოთამაშე</div>
                  <div className="th center">მოგება</div>
                  <div className="th center">თამაში</div>
                  <div className="th center">მოგ. %</div>
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
              მოგებები ითვლება ლაივ და ონლაინ თამაშებში, სადაც ყველა არჩეული მოთამაშე თამაშობდა.
            </p>
          </div>
        </>
      )}

      <div className="actions">
        <button className="primary" onClick={onBack}>სტატისტიკაში დაბრუნება</button>
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
        <div className="h2h-sub">მოგება</div>
      </div>
      <div className="h2h-dash">–</div>
      <div className="h2h-side">
        <div className="h2h-name">{b.name}</div>
        <div className={`h2h-score ${bWins > aWins ? 'pos' : ''}`}>{bWins}</div>
        <div className="h2h-sub">მოგება</div>
      </div>
      <div className="h2h-ties">
        {others > 0 && <>{others} თამაში სხვებმა მოიგეს · </>}
        წინ დაასრულა: {a.name} {aAhead}× · {b.name} {bAhead}×
      </div>
    </div>
  )
}

// 3–4 player pairwise grid: cell[row][col] = times row outscored col
function H2HMatrix({ selected, h2h, nameById }) {
  const players = selected.map(s => ({ key: s.id, label: nameById[s.id] }))
  return (
    <HeatMatrix
      corner="აჯობა ↓ / ვის →"
      rows={players}
      cols={players}
      countOf={(row, col) => h2h[row]?.[col]}
    />
  )
}
