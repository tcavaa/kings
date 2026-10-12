import { useMemo, useState } from 'react'
import { usePlayers } from '../hooks/usePlayers'

export default function PlayerInput({ onStart }) {
  const { players: savedPlayers, loading } = usePlayers()
  const [numPlayers, setNumPlayers] = useState(3)
  const [selectedIds, setSelectedIds] = useState(['', '', '', ''])

  function updateSelection(index, id) {
    setSelectedIds((prev) => {
      const next = [...prev]
      next[index] = id
      return next
    })
  }

  const slice = selectedIds.slice(0, numPlayers)

  const canStart = useMemo(() => {
    return slice.every((id) => id !== '') && new Set(slice).size === numPlayers
  }, [slice, numPlayers])

  function startGame() {
    if (!canStart) return
    const players = slice.map((id) => {
      const p = savedPlayers.find((sp) => sp.id === id)
      return { id, name: p.name }
    })
    onStart(players)
  }

  return (
    <div className="card player-input">
      <h2>Set up players</h2>
      <div className="row">
        <label className="inline">
          <span>Number of players</span>
          <select value={numPlayers} onChange={(e) => setNumPlayers(Number(e.target.value))}>
            <option value={3}>3</option>
            <option value={4}>4</option>
          </select>
        </label>
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted)', marginTop: 8 }}>Loading players...</p>
      ) : savedPlayers.length < numPlayers ? (
        <p className="validation" style={{ marginTop: 8 }}>
          Not enough players saved. Go to <strong>Players</strong> in the menu to add at least {numPlayers}.
        </p>
      ) : (
        <div className="inputs-grid">
          {Array.from({ length: numPlayers }).map((_, i) => (
            <label key={i} className="input-row">
              <span>Player {i + 1}</span>
              <select
                value={selectedIds[i]}
                onChange={(e) => updateSelection(i, e.target.value)}
                style={{ flex: 1 }}
              >
                <option value="">-- Select --</option>
                {savedPlayers.map((p) => (
                  <option
                    key={p.id}
                    value={p.id}
                    disabled={slice.includes(p.id) && selectedIds[i] !== p.id}
                  >
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="actions">
        <button type="button" className="primary" style={{ minHeight: 44 }} disabled={!canStart} onClick={startGame}>
          Start Game
        </button>
      </div>
    </div>
  )
}
