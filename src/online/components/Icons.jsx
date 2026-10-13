import {
  Heart, Diamond, Spade, Club,
} from 'lucide-react-online'
import { SUIT_NAMES } from '../constants/suits'

const SUIT_ICONS = { H: Heart, D: Diamond, S: Spade, C: Club }
const SUIT_COLOR = { H: '#dc2626', D: '#dc2626', S: '#1a1a1a', C: '#1a1a1a' }

/**
 * Renders a card-suit icon (Lucide). Use `mono` to skip the red/black color.
 */
export function SuitIcon({ suit, size = 14, mono = false, className = '', style = {} }) {
  const Icon = SUIT_ICONS[suit]
  if (!Icon) return null
  return (
    <Icon
      size={size}
      strokeWidth={2.25}
      className={className}
      style={{ color: mono ? undefined : SUIT_COLOR[suit], ...style }}
      fill={mono ? 'none' : SUIT_COLOR[suit]}
    />
  )
}

export function SuitLabel({ suit, size = 14, className = '', style = {} }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} style={style}>
      <SuitIcon suit={suit} size={size} />
      <span>{SUIT_NAMES[suit]}</span>
    </span>
  )
}

