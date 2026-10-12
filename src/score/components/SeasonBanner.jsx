import {
  Trophy, TreePine, Mountain, Bird, Gift, Snowflake, Sun, Umbrella,
  Shell, Club, Spade, Heart, Diamond,
} from 'lucide-react'
import { getTheme } from '../utils/themes'
import { splitWinnerNames } from '../utils/winners'

/* Per-theme decorative layers scattered inside the hero. Everything is
   aria-hidden, absolutely positioned and non-interactive. */
function HeroDecor({ themeId }) {
  if (themeId === 'mountain') {
    return (
      <div className="hero-decor" aria-hidden>
        <Mountain className="hero-icon hero-mountain-peak" size={92} strokeWidth={1.2} />
        <TreePine className="hero-icon hero-tree hero-tree-1" size={40} />
        <TreePine className="hero-icon hero-tree hero-tree-2" size={26} />
        <TreePine className="hero-icon hero-tree hero-tree-3" size={46} />
        <TreePine className="hero-icon hero-tree hero-tree-4" size={30} />
        <Bird className="hero-icon hero-hero-bird" size={20} />
        <div className="hero-mist" />
      </div>
    )
  }
  if (themeId === 'christmas') {
    return (
      <div className="hero-decor" aria-hidden>
        <div className="hero-lights" />
        <Gift className="hero-icon hero-gift hero-gift-1" size={34} />
        <Gift className="hero-icon hero-gift hero-gift-2" size={22} />
        <Gift className="hero-icon hero-gift hero-gift-3" size={28} />
        <TreePine className="hero-icon hero-xmas-tree" size={58} />
        <Snowflake className="hero-icon hero-flake hero-flake-1" size={18} />
        <Snowflake className="hero-icon hero-flake hero-flake-2" size={12} />
        <Snowflake className="hero-icon hero-flake hero-flake-3" size={15} />
      </div>
    )
  }
  if (themeId === 'summer') {
    return (
      <div className="hero-decor" aria-hidden>
        <Sun className="hero-icon hero-sun" size={84} strokeWidth={1.4} />
        <Umbrella className="hero-icon hero-umbrella" size={44} />
        <Shell className="hero-icon hero-shell" size={22} />
        <div className="hero-wave-line" />
      </div>
    )
  }
  // casual — faint suits in the corners
  return (
    <div className="hero-decor" aria-hidden>
      <Spade className="hero-icon hero-suit hero-suit-1" size={44} />
      <Heart className="hero-icon hero-suit hero-suit-2" size={30} />
      <Club className="hero-icon hero-suit hero-suit-3" size={36} />
      <Diamond className="hero-icon hero-suit hero-suit-4" size={26} />
    </div>
  )
}

/**
 * The season hero under the header: big centered season title with the
 * reigning champion beneath, dressed in the current theme's scenery.
 * Editing (rename / theme) lives in the More tab.
 */
export default function SeasonBanner({ seasonName, themeId, champion }) {
  const theme = getTheme(themeId)
  const champions = splitWinnerNames(champion)

  return (
    <div className={`season-hero season-hero-${theme.id}`}>
      <HeroDecor themeId={theme.id} />
      <div className="season-hero-content">
        <h2 className="season-hero-title">{seasonName || 'Unnamed Season'}</h2>
        {champions.length > 0 && (
          <div className="season-hero-champion" title={`Last season champion${champions.length > 1 ? 's' : ''}`}>
            <Trophy size={16} />
            <strong>{champions.join(' & ')}</strong>
          </div>
        )}
      </div>
    </div>
  )
}
