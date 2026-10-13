import { AwardIcon } from '../utils/gameIcons'

// Award cards ({ icon, title, player, value }), for one game or all of them.
export default function AwardsGrid({ awards, emptyText = null }) {
  return (
    <div className="awards-grid">
      {awards.map((a, i) => (
        <div key={i} className="award-card">
          <div className="award-icon"><AwardIcon name={a.icon} /></div>
          <div className="award-title">{a.title}</div>
          <div className="award-player">{a.player}</div>
          <div className="award-value">{a.value}</div>
        </div>
      ))}
      {awards.length === 0 && emptyText && (
        <p style={{ color: 'var(--muted)', fontSize: 13 }}>{emptyText}</p>
      )}
    </div>
  )
}
