import { ACHIEVEMENT_DEFS } from '../utils/achievements'

/**
 * Renders achievement badges from { [code]: count }.
 * Shows ×N below the icon when a repeatable achievement was earned multiple times.
 */
export default function AchievementBadges({ achievements }) {
  const entries = Object.entries(achievements || {}).filter(([, count]) => count > 0)
  if (!entries.length) return null

  return (
    <div className="achievement-badges">
      {entries.map(([code, count]) => {
        const def = ACHIEVEMENT_DEFS[code]
        if (!def) return null
        return (
          <div key={code} className="achievement-badge" title={`${def.label}: ${def.desc}`}>
            <div className="achievement-badge-icon"><def.Icon size={19} color={def.color} /></div>
            <div className="achievement-badge-label">{def.label}</div>
            {count > 1 && <div className="achievement-badge-count">×{count}</div>}
          </div>
        )
      })}
    </div>
  )
}
