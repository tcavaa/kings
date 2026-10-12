import { memo, useEffect, useState } from 'react'
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
    // No absolute positioning: this renders as the second row of the TopBar's
    // centre column, so flex puts it under the round/type/trump pills and it
    // cannot overlap them however wide or tall they grow.
    <div
      className="pointer-events-none select-none inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full"
      style={{
        background: 'rgba(23,39,35,0.82)',
        border: '1px solid rgba(151,176,162,0.35)',
        boxShadow: '0 1px 0 rgba(0,0,0,0.15)',
        backdropFilter: 'blur(2px)',
      }}
      title="თამაშის ხანგრძლივობა"
    >
      <span className="text-[11px] lg:text-xs font-mono font-bold tabular-nums leading-none"
            style={{ color: 'rgba(225,233,225,0.85)' }}>
        {format(now - gameStartedAt)}
      </span>
    </div>
  )
}

// Ticks once a second on its own; memo keeps GameLayout's unrelated re-renders
// (chat, drawers) from doing it more often than that.
export default memo(GameTimer)
