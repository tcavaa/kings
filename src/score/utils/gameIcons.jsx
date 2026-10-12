// Central lucide-icon registry for the game's iconography — card types,
// award categories — so no component hand-rolls emojis.

import {
  Heart, HeartCrack, Crown, Spade, Layers, Skull, Sparkles,
  Trophy, Wallet, TrendingUp, Gamepad2,
} from 'lucide-react'

/** One icon + color per game type code (P covers P1/P2/P3). */
const TYPE_ICONS = {
  K:  { Icon: HeartCrack, color: '#dc2626' },
  Q:  { Icon: Crown,      color: '#b45309' },
  J:  { Icon: Spade,      color: '#475569' },
  H:  { Icon: Heart,      color: '#e11d48' },
  L2: { Icon: Layers,     color: '#7c3aed' },
  T:  { Icon: Skull,      color: '#64748b' },
  P:  { Icon: Sparkles,   color: '#059669' },
  P1: { Icon: Sparkles,   color: '#059669' },
  P2: { Icon: Sparkles,   color: '#059669' },
  P3: { Icon: Sparkles,   color: '#059669' },
}

export function CardTypeIcon({ code, size = 13, style }) {
  const entry = TYPE_ICONS[code]
  if (!entry) return null
  const { Icon, color } = entry
  return <Icon size={size} color={color} style={{ verticalAlign: '-2px', ...style }} />
}

/** Award-card icons, keyed by the `icon` field analytics.js emits. */
const AWARD_ICONS = {
  ...TYPE_ICONS,
  winner:   { Icon: Trophy,     color: '#d4a017' },
  champion: { Icon: Trophy,     color: '#d4a017' },
  loser:    { Icon: Wallet,     color: '#dc2626' },
  avg:      { Icon: TrendingUp, color: '#059669' },
  games:    { Icon: Gamepad2,   color: '#2563eb' },
}

export function AwardIcon({ name, size = 26 }) {
  const entry = AWARD_ICONS[name]
  if (!entry) return null
  const { Icon, color } = entry
  return <Icon size={size} color={color} />
}
