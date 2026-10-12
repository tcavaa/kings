/**
 * Label/value stat line used by the game-over screen and the leaderboard
 * player cards. `className` lets call sites add size utilities (e.g.
 * `text-[11px]`); `color` overrides the value's ink color.
 */
export default function StatRow({ label, value, color, className = '' }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${className}`}>
      <span style={{ color: 'rgba(213,185,130,0.7)' }}>{label}</span>
      <span className="font-mono font-bold" style={{ color: color || '#eeeae1' }}>{value}</span>
    </div>
  )
}
