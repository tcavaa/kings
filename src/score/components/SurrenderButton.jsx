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
        title={disabled ? 'ჯერ ერთი რაუნდი მაინც ითამაშე' : 'თამაშის ვადამდე დასრულება'}
        onClick={() => setOpen(true)}
      >
        <Flag size={13} /> დანებება
      </button>
    )
  }

  const pick = (p) => {
    const ok = window.confirm(`${p.name} ნებდება? თამაში ახლავე დასრულდება და ქულების ლიდერი მოიგებს.`)
    if (!ok) return
    setOpen(false)
    onSurrender(p.id)
  }

  return (
    <div className="surrender-picker" role="group" aria-label="ვინ ნებდება?">
      <span className="surrender-picker-label">ვინ ნებდება?</span>
      {players.map(p => (
        <button key={p.id} type="button" className="link reset-game-btn" onClick={() => pick(p)}>
          {p.name}
        </button>
      ))}
      <button type="button" className="link reset-game-btn" aria-label="გაუქმება" onClick={() => setOpen(false)}>
        <X size={13} />
      </button>
    </div>
  )
}
