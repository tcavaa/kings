import { Trophy } from 'lucide-react'
import { splitWinnerNames } from '../utils/winners'

export default function SeasonBanner({ seasonName, champion }) {
  const champions = Array.isArray(champion) ? champion : splitWinnerNames(champion)
  return (
    <section className="season-hero" aria-label="მიმდინარე სეზონი">
      <div className="season-hero-content">
        <p className="season-eyebrow">მიმდინარე სეზონი</p>
        <h2 className="season-hero-title">{seasonName || 'King Score'}</h2>
      </div>
      {champions.length > 0 && (
        <div className="season-hero-champion">
          <Trophy size={18} aria-hidden="true" />
          <div><span>წინა სეზონის ჩემპიონი</span><strong>{champions.join(' & ')}</strong></div>
        </div>
      )}
    </section>
  )
}
