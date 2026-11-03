import { GAME_TYPE_RULES } from '../../../server/game/gameTypes.js'
import { GAME_TYPES as ONLINE_TYPES } from '../../online/constants/gameTypes.js'

// ჩაწერა's labels for the nine game types. How each one scores (kind,
// totalUnits, pointsPerUnit) comes from the rules King Online's server plays
// by (server/game/gameTypes.js).
const LABELS = {
  K:  { label: 'K — არ აიღო გულის მეფე' },
  Q:  { label: 'Q — არ აიღო დამები', unitLabel: 'დამები' },
  J:  { label: 'J — არ აიღო ვალეტები', unitLabel: 'ვალეტები' },
  H:  { label: '<3 — არ აიღო გულები', unitLabel: 'გულები' },
  L2: { label: 'L2 — არ აიღო ბოლო ორი', unitLabel: 'ბოლო ორი' },
  T:  { label: '- — არ აიღო მინუსები', unitLabel: 'მინუსები' },
  P1: { label: '+ — პლიუსი 1', unitLabel: 'მინუსები' },
  P2: { label: '+ — პლიუსი 2', unitLabel: 'მინუსები' },
  P3: { label: '+ — პლიუსი 3', unitLabel: 'მინუსები' },
}

// Colours match King Online's game picker, so a type looks the same in both.
const COLORS = Object.fromEntries(ONLINE_TYPES.map(t => [t.code, t.color]))

export const GAME_TYPES = GAME_TYPE_RULES.map(rule => ({ ...rule, ...LABELS[rule.code], color: COLORS[rule.code] }))
