import { useMemo, useState, useEffect, useRef } from 'react'
import { GAME_TYPES } from '../constants/gameTypes'
import { computeScoresForRound } from '../utils/scoring'
import { countsSum, normalizeCount, validateRound } from '../utils/rounds'
import { TYPE_BTN_DECOR } from '../utils/decorations'

// The chosen type lives in App, so a tap on the availability matrix and a
// tap here pick the same thing.
export default function GameTypeSelector({
  players,
  activePlayerIndex,
  usedTypesByPlayer,
  selectedTypeCode,
  onSelectType,
  onRoundComplete,
}) {
  const [countsByPlayerId, setCountsByPlayerId] = useState({})
  const [singleTargetPlayerId, setSingleTargetPlayerId] = useState(null)

  const activePlayer = players[activePlayerIndex]

  const availableTypesForActive = useMemo(() => {
    const usedSet = usedTypesByPlayer[activePlayer.id] || new Set()
    return GAME_TYPES.filter((t) => !usedSet.has(t.code))
  }, [activePlayer.id, usedTypesByPlayer])

  // Only a type the current leader still has: after an Undo hands the lead
  // back, a type picked for the next leader must not carry over.
  const selectedType = useMemo(
    () => availableTypesForActive.find((t) => t.code === selectedTypeCode) || null,
    [selectedTypeCode, availableTypesForActive]
  )

  const sumCounts = useMemo(() => countsSum(countsByPlayerId), [countsByPlayerId])

  const validationMessage = useMemo(
    () => validateRound(selectedType, countsByPlayerId, singleTargetPlayerId),
    [selectedType, countsByPlayerId, singleTargetPlayerId]
  )

  function handleCountChange(playerId, value) {
    setCountsByPlayerId((prev) => ({ ...prev, [playerId]: normalizeCount(value) }))
  }

  function computeScores() {
    return computeScoresForRound(selectedType, players, countsByPlayerId, singleTargetPlayerId)
  }

  function endRound() {
    if (validationMessage) return
    const scores = computeScores()
    const roundRecord = {
      leaderPlayerId: activePlayer.id,
      gameTypeCode: selectedType.code,
      countsByPlayerId: selectedType.kind === 'count' ? { ...countsByPlayerId } : null,
      singleTargetPlayerId: selectedType.kind === 'single' ? singleTargetPlayerId : null,
      scores,
    }
    onRoundComplete(roundRecord)
    setCountsByPlayerId({})
    setSingleTargetPlayerId(null)
  }

  const firstInputRef = useRef(null)
  useEffect(() => {
    if (selectedType && selectedType.kind === 'count') {
      firstInputRef.current && firstInputRef.current.focus()
    }
  }, [selectedType])

  return (
    <div className="card game-type-selector">
      <h2>Choose a game type — {activePlayer.name}</h2>

      <div className="type-grid">
        {availableTypesForActive.map((t) => (
          <button
            key={t.code}
            className={selectedTypeCode === t.code ? 'type-btn selected' : 'type-btn'}
            onClick={() => onSelectType(t.code)}
            type="button"
            data-decor={TYPE_BTN_DECOR[t.code]}
          >
            {t.label}
          </button>
        ))}
      </div>

      {selectedType && selectedType.kind === 'count' && (
        <div className="inputs">
          <h3>Distribute {selectedType.totalUnits} {selectedType.unitLabel || 'units'}</h3>
          <div className="inputs-grid">
            {players.map((p, i) => (
              <label key={p.id} className="input-row">
                <span>{p.name}</span>
                <div className="stepper">
                  <button type="button" className="link" onClick={() => handleCountChange(p.id, (countsByPlayerId[p.id] || 0) - 1)}>-</button>
                  <input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="num-input"
                  ref={i === 0 ? firstInputRef : undefined}
                  value={countsByPlayerId[p.id] ?? ''}
                  onChange={(e) => handleCountChange(p.id, e.target.value)}
                />
                  <button type="button" className="link" onClick={() => handleCountChange(p.id, (countsByPlayerId[p.id] || 0) + 1)}>+</button>
                </div>
              </label>
            ))}
          </div>
          <div className="sum-note">Sum: {sumCounts} / {selectedType.totalUnits}</div>
        </div>
      )}

      {selectedType && selectedType.kind === 'single' && (
        <div className="inputs">
          <h3>Select the player who took it</h3>
          <div className="radio-grid">
            {players.map((p) => (
              <label key={p.id} className="radio-row">
                <input
                  type="radio"
                  name="singleTarget"
                  checked={singleTargetPlayerId === p.id}
                  onChange={() => setSingleTargetPlayerId(p.id)}
                />
                <span>{p.name}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {validationMessage && (
        <div className="validation">{validationMessage}</div>
      )}

      <div className="actions sticky-footer">
        <button type="button" className="primary" disabled={Boolean(validationMessage)} onClick={endRound}>
          End Round
        </button>
      </div>
    </div>
  )
}


