import { useMemo, useState, useEffect, useRef } from 'react'
import { GAME_TYPES } from '../constants/gameTypes'
import { computeScoresForRound } from '../utils/scoring'
import { TYPE_BTN_DECOR } from '../utils/decorations'

export default function GameTypeSelector({
  players,
  activePlayerIndex,
  usedTypesByPlayer,
  preselectedCode,
  onRoundComplete,
}) {
  const [selectedTypeCode, setSelectedTypeCode] = useState(null)
  const [countsByPlayerId, setCountsByPlayerId] = useState({})
  const [singleTargetPlayerId, setSingleTargetPlayerId] = useState(null)

  const activePlayer = players[activePlayerIndex]

  const availableTypesForActive = useMemo(() => {
    const usedSet = usedTypesByPlayer[activePlayer.id] || new Set()
    return GAME_TYPES.filter((t) => !usedSet.has(t.code))
  }, [activePlayer.id, usedTypesByPlayer])

  const selectedType = useMemo(
    () => GAME_TYPES.find((t) => t.code === selectedTypeCode) || null,
    [selectedTypeCode]
  )

  useEffect(() => {
    if (!preselectedCode) return
    const usedSet = usedTypesByPlayer[activePlayer.id] || new Set()
    if (!usedSet.has(preselectedCode)) setSelectedTypeCode(preselectedCode)
  }, [preselectedCode, activePlayer.id, usedTypesByPlayer])

  useEffect(() => {
    function handler(e) {
      const code = e.detail?.code
      if (!code) return
      const usedSet = usedTypesByPlayer[activePlayer.id] || new Set()
      if (!usedSet.has(code)) setSelectedTypeCode(code)
    }
    window.addEventListener('preselectGameType', handler)
    return () => window.removeEventListener('preselectGameType', handler)
  }, [activePlayer.id, usedTypesByPlayer])

  const sumCounts = useMemo(
    () => Object.values(countsByPlayerId).reduce((a, b) => a + (Number(b) || 0), 0),
    [countsByPlayerId]
  )

  const validationMessage = useMemo(() => {
    if (!selectedType) return 'Choose a game type'
    if (selectedType.kind === 'count') {
      if (sumCounts !== selectedType.totalUnits) {
        return `Distribute exactly ${selectedType.totalUnits} ${selectedType.unitLabel || 'units'} across players`
      }
      return ''
    }
    if (selectedType.kind === 'single') {
      if (!singleTargetPlayerId) return 'Select the player who took it'
      return ''
    }
    return ''
  }, [selectedType, sumCounts, singleTargetPlayerId])

  function handleCountChange(playerId, value) {
    setCountsByPlayerId((prev) => ({ ...prev, [playerId]: Math.max(0, Number(value || 0)) }))
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
    setSelectedTypeCode(null)
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
            onClick={() => setSelectedTypeCode(t.code)}
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
            {players.map((p) => (
              <label key={p.id} className="input-row">
                <span>{p.name}</span>
                <div className="stepper">
                  <button type="button" className="link" onClick={() => handleCountChange(p.id, (countsByPlayerId[p.id] || 0) - 1)}>-</button>
                  <input
                  type="number"
                  min="0"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  className="num-input"
                  ref={firstInputRef}
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


