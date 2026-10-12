import { memo, useEffect, useState } from 'react'
import { Timer } from 'lucide-react-online'
import { useGame } from '../../context/GameContext'

/** ms → M:SS, rolling over to H:MM:SS only once a game actually passes an hour. */
function format(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  const pad = (n) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * How long this game has been running.
 *
 * The origin is `startedAt`, stamped on the server when the cards were dealt,
 * so all three players read the same number and a refresh doesn't restart the
 * clock. Ticking locally off that timestamp (rather than counting up from
 * mount) also means a backgrounded tab — where browsers throttle timers hard —
 * shows the correct time the instant it comes back, instead of however many
 * ticks it managed to fire while hidden.
 */
function GameTimer() {
  const { gameStartedAt } = useGame()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!gameStartedAt) return undefined
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [gameStartedAt])

  if (!gameStartedAt) return null

  return (
    // Sits in the TopBar's tools row (a span, so the row's `> div` reset
    // rules don't touch it); styled by .k-game-timer.
    <span className="k-game-timer" title="თამაშის ხანგრძლივობა">
      <Timer size={15} aria-hidden="true" />
      <span>{format(now - gameStartedAt)}</span>
    </span>
  )
}

// Ticks once a second on its own; memo keeps GameLayout's unrelated re-renders
// (chat, drawers) from doing it more often than that.
export default memo(GameTimer)
