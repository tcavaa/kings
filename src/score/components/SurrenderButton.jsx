import { useState } from 'react'
import { Flag, X } from 'lucide-react'

/**
 * Ends the game early, like a surrender in King Online: someone gives up,
 * the game stops where it stands and the highest score wins. Pick who
 * surrenders, then confirm. Needs at least one round on the sheet.
 */
export default function SurrenderButton({ players, roundsPlayed, onSurrender }) {
  const [open, setOpen] = useState(false)
  const disabled = roundsPlayed === 0

  if (!open) {
    return (
      <button
        type="button"
        className="link danger-link reset-game-btn"
        disabled={disabled}
        title={disabled ? 'Play at least one round first' : 'End the game early'}
        onClick={() => setOpen(true)}
      >
        <Flag size={13} /> Surrender
      </button>
    )
  }

  const pick = (p) => {
    const ok = window.confirm(`${p.name} surrenders? The game ends now and the highest score wins.`)
    if (!ok) return
    setOpen(false)
    onSurrender(p.id)
  }

  return (
    <div className="surrender-picker" role="group" aria-label="Who surrenders?">
      <span className="surrender-picker-label">Who surrenders?</span>
      {players.map(p => (
        <button key={p.id} type="button" className="link reset-game-btn" onClick={() => pick(p)}>
          {p.name}
        </button>
      ))}
      <button type="button" className="link reset-game-btn" aria-label="Cancel" onClick={() => setOpen(false)}>
        <X size={13} />
      </button>
    </div>
  )
}
