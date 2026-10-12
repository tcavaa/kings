import { useEffect, useState } from 'react'
import { Timer } from 'lucide-react'
import { formatDuration } from '../utils/time'

/**
 * Floating game clock. Starts ticking the moment a game starts (startedAt
 * lives in the reducer state, so it survives refreshes via localStorage)
 * and freezes on the final duration once the game ends. Always visible
 * while a game exists, on every tab.
 */
export default function GameTimer({ startedAt, endedAt }) {
  const running = !!startedAt && !endedAt
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!running) return undefined
    const id = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [running])

  if (!startedAt) return null
  const seconds = ((endedAt || Date.now()) - startedAt) / 1000

  return (
    <div
      className={`game-timer ${endedAt ? 'game-timer-finished' : ''}`}
      title={endedAt ? 'Final game duration' : 'Game in progress'}
    >
      <Timer size={13} />
      <span className="game-timer-value">{formatDuration(seconds)}</span>
    </div>
  )
}
