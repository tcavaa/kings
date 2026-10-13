import { Crown, Diamond, Spade, Heart, AlertTriangle, Ban, Plus, TrendingUp } from 'lucide-react'
import { GAME_TYPE_RULES } from '../../../server/game/gameTypes.js'

// King Online's names, icons and colours for the nine game types. How each
// one scores (kind, totalUnits, pointsPerUnit) comes from the shared rules.
const LABELS = {
  K:  { name: 'კინგი',      Icon: Crown,         description: 'არ აიღო გულის მეფე. −40 ქულა.',           color: '#edb2a0' },
  Q:  { name: 'დამები',     Icon: Diamond,       description: 'არ აიღო დამები. −10 თითოზე.',             color: '#c6a6c5' },
  J:  { name: 'ვალეტები',   Icon: Spade,         description: 'არ აიღო ვალეტები. −10 თითოზე.',           color: '#9cbdce' },
  H:  { name: 'გულები',     Icon: Heart,         description: 'არ აიღო გულები. −5 თითოზე.',              color: '#ed9999' },
  L2: { name: 'ბოლო ორი',   Icon: AlertTriangle, description: 'არ აიღო ბოლო ორი მინუსი. −20 თითოზე.',     color: '#d5b982' },
  T:  { name: 'მინუსი',    Icon: Ban,           description: 'არ აიღო მინუსები. −4 თითოზე.',             color: '#c0b2a0' },
  P1: { name: 'პლიუსი 1',   Icon: Plus,          description: 'აიღე რაც შეიძლება მეტი. +8 თითო მინუსზე.', color: '#a9c88b' },
  P2: { name: 'პლიუსი 2',   Icon: Plus,          description: 'აიღე რაც შეიძლება მეტი. +8 თითო მინუსზე.', color: '#84c6b0' },
  P3: { name: 'პლიუსი 3',   Icon: TrendingUp,    description: 'აიღე რაც შეიძლება მეტი. +8 თითო მინუსზე.', color: '#a5bbed' },
}

export const GAME_TYPES = GAME_TYPE_RULES.map((rule) => ({ ...rule, ...LABELS[rule.code] }))

export const getGameType = (code) => GAME_TYPES.find(t => t.code === code)
