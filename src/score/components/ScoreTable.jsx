import { useEffect, useMemo, useRef, useState } from 'react'
import { Crown, Handshake, Skull, Pencil, Undo2 } from 'lucide-react'
import { GAME_TYPES } from '../constants/gameTypes'
import TrophyIcon from './TrophyIcon'
import { isChampionName } from '../utils/winners'

function AnimatedScore({ value, from = 0, showSign = true }) {
  const [displayed, setDisplayed] = useState(from)
  const frameRef = useRef(null)

  useEffect(() => {
    const startVal = from
    const target = value
    if (startVal === target) { setDisplayed(target); return }
    const duration = 500
    const startTime = performance.now()
    function step(now) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(Math.round(startVal + eased * (target - startVal)))
      if (progress < 1) frameRef.current = requestAnimationFrame(step)
    }
    frameRef.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frameRef.current)
  }, [value, from])

  return <span className="score-animated">{showSign && displayed > 0 ? `+${displayed}` : displayed}</span>
}

export default function ScoreTable({ players, rounds, onEditLastRound, onUndoLastRound, gameFinished, playerColors = [], currentChampion }) {
  const totals = players.reduce((acc, p) => { acc[p.id] = 0; return acc }, {})
  rounds.forEach((r) => {
    Object.entries(r.scores).forEach(([pid, score]) => { totals[pid] += score })
  })

  const maxTotal = rounds.length > 0 && players.length > 0 ? Math.max(...players.map(p => totals[p.id])) : null
  const leaders = new Set(maxTotal !== null ? players.filter(p => totals[p.id] === maxTotal).map(p => p.id) : [])
  const isTie = leaders.size > 1

  const [isEditing, setIsEditing] = useState(false)
  const lastIndex = rounds.length - 1
  const lastRound = rounds[lastIndex]
  const prevRoundCountRef = useRef(rounds.length)
  const [newRowIdx, setNewRowIdx] = useState(-1)
  const prevTotalsRef = useRef({})

  useEffect(() => {
    if (rounds.length > prevRoundCountRef.current) {
      // Compute totals WITHOUT the new last round (previous state)
      const prev = {}
      players.forEach(p => { prev[p.id] = 0 })
      rounds.slice(0, -1).forEach(r => {
        Object.entries(r.scores || {}).forEach(([pid, score]) => { prev[pid] += score })
      })
      prevTotalsRef.current = prev
      setNewRowIdx(rounds.length - 1)
      const t = setTimeout(() => setNewRowIdx(-1), 900)
      prevRoundCountRef.current = rounds.length
      return () => clearTimeout(t)
    }
    prevRoundCountRef.current = rounds.length
  }, [rounds.length])

  const [draftCounts, setDraftCounts] = useState(() => {
    if (!lastRound || !lastRound.countsByPlayerId) return {}
    return { ...lastRound.countsByPlayerId }
  })
  const [draftSingle, setDraftSingle] = useState(() => lastRound?.singleTargetPlayerId || null)

  const selectedTypeCode = lastRound?.gameTypeCode
  const selectedType = GAME_TYPES.find((t) => t.code === selectedTypeCode)

  function startEdit() {
    if (!lastRound) return
    setDraftCounts({ ...(lastRound.countsByPlayerId || {}) })
    setDraftSingle(lastRound.singleTargetPlayerId || null)
    setIsEditing(true)
  }
  function cancelEdit() { setIsEditing(false) }
  function changeCount(pid, val) {
    setDraftCounts((p) => ({ ...p, [pid]: Math.max(0, Number(val || 0)) }))
  }
  function saveEdit() {
    if (!onEditLastRound || !lastRound) return
    onEditLastRound({
      countsByPlayerId: lastRound.countsByPlayerId ? { ...draftCounts } : null,
      singleTargetPlayerId: lastRound.singleTargetPlayerId != null ? draftSingle : null,
    })
    setIsEditing(false)
  }

  const draftSum = useMemo(() => {
    if (!isEditing || !lastRound || !lastRound.countsByPlayerId) return 0
    return Object.values(draftCounts).reduce((a, b) => a + (Number(b) || 0), 0)
  }, [isEditing, lastRound, draftCounts])

  const validationMessage = useMemo(() => {
    if (!isEditing || !selectedType) return ''
    if (selectedType.kind === 'count') {
      if (draftSum !== selectedType.totalUnits) return `Distribute exactly ${selectedType.totalUnits} ${selectedType.unitLabel || 'units'}`
    }
    if (selectedType.kind === 'single' && !draftSingle) return 'Select the player who took it'
    return ''
  }, [isEditing, selectedType, draftSum, draftSingle])

  // Danger zone: player more than 190pts behind leader (only after at least 1 round)
  const dangerIds = new Set(
    rounds.length > 0
      ? players.filter(p => maxTotal - totals[p.id] >= 190).map(p => p.id)
      : []
  )

  return (
    <div className="card score-table" style={{ '--player-count': players.length }}>
      <h2>Scores</h2>
      <div className="table">
        <div className="thead">
          <div className="tr">
            <div className="th">Round / Type</div>
            {players.map((p, i) => (
              <div
                key={p.id}
                className="th center player-color-header"
                style={{ borderBottom: playerColors[i] ? `3px solid ${playerColors[i]}` : undefined }}
              >
                <div style={{ fontSize: 12, lineHeight: 1, marginBottom: 2, minHeight: 14 }}>
                  {leaders.has(p.id)
                    ? (isTie ? <Handshake size={13} /> : <Crown size={13} style={{ color: 'var(--accent-gold)' }} />)
                    : ''}
                </div>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {p.name}
                  {isChampionName(currentChampion, p.name) && <TrophyIcon size={16} color="#d4a017" />}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="tbody">
          {rounds.map((r, idx) => {
            const isLast = idx === lastIndex
            const isNew = idx === newRowIdx
            return (
              <div key={idx} className={`tr${isNew ? ' score-new-row' : ''}`}>
                <div className="td player-name">
                  {idx + 1} — {r.gameTypeCode}
                  {isLast && (
                    <span className="edit-actions">
                      {!isEditing && (
                        <>
                          <button className="link icon-btn" onClick={startEdit} title="Edit last round"><Pencil size={11} /> Edit</button>
                          {onUndoLastRound && (
                            <button className="link icon-btn" onClick={onUndoLastRound} title="Undo last round" style={{ color: 'var(--muted)' }}><Undo2 size={11} /> Undo</button>
                          )}
                        </>
                      )}
                      {isEditing && (
                        <>
                          <button className="link" disabled={Boolean(validationMessage)} onClick={saveEdit}>Save</button>
                          <button className="link" onClick={cancelEdit}>Cancel</button>
                        </>
                      )}
                    </span>
                  )}
                </div>
                {players.map((p) => {
                  const display = r.scores[p.id]
                  const className = typeof display === 'number' ? (display >= 0 ? 'td center pos' : 'td center neg') : 'td center'
                  return (
                    <div key={p.id} className={className}>
                      {isEditing && isLast && r.countsByPlayerId ? (
                        <input type="number" min="0" inputMode="numeric" pattern="[0-9]*" className="num-input" value={draftCounts[p.id] ?? ''} onChange={(e) => changeCount(p.id, e.target.value)} />
                      ) : isEditing && isLast && r.singleTargetPlayerId != null ? (
                        <input type="radio" name="editSingle" checked={draftSingle === p.id} onChange={() => setDraftSingle(p.id)} />
                      ) : isNew && typeof display === 'number' ? (
                        <AnimatedScore value={display} />
                      ) : (
                        display ?? ''
                      )}
                    </div>
                  )
                })}
                {isEditing && isLast && selectedType && selectedType.kind === 'count' && (
                  <div className="td center" style={{ gridColumn: `1 / span ${players.length + 1}` }}>
                    <div className="sum-note">Sum: {draftSum} / {selectedType.totalUnits}</div>
                    {validationMessage && <div className="validation">{validationMessage}</div>}
                  </div>
                )}
              </div>
            )
          })}
          <div className="tr totals-tr">
            <div className="td bold">Totals</div>
            {players.map((p) => {
              const val = totals[p.id]
              const inDanger = dangerIds.has(p.id)
              let cls = val >= 0 ? 'td center bold pos' : 'td center bold neg'
              if (inDanger) cls += ' danger-zone'
              const isAnimating = newRowIdx !== -1
              const fromVal = prevTotalsRef.current[p.id] ?? val
              return (
                <div key={p.id} className={cls}>
                  {inDanger && <Skull size={12} style={{ verticalAlign: '-1px', marginRight: 3, color: 'var(--accent-bad)' }} />}
                  {isAnimating
                    ? <AnimatedScore value={val} from={fromVal} showSign={false} />
                    : val}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {gameFinished && leaders.size > 0 && (
        <div className="winner">
          {isTie
            ? <><Handshake size={15} style={{ verticalAlign: '-2px', marginRight: 5 }} />Tie: <strong>{players.filter(p => leaders.has(p.id)).map(p => p.name).join(' & ')}</strong> with {maxTotal} points</>
            : <><Crown size={15} style={{ verticalAlign: '-2px', marginRight: 5, color: 'var(--accent-gold)' }} />Winner: <strong>{players.find(p => leaders.has(p.id))?.name}</strong> with {maxTotal} points</>
          }
        </div>
      )}
    </div>
  )
}
