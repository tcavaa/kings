import { GAME_TYPE_RULES } from '../../../server/game/gameTypes.js'

// ჩაწერა's labels for the nine game types. How each one scores (kind,
// totalUnits, pointsPerUnit) comes from the rules King Online's server plays
// by (server/game/gameTypes.js).
const LABELS = {
  K:  { label: 'K — No King of hearts' },
  Q:  { label: 'Q — No Queens', unitLabel: 'Queens' },
  J:  { label: 'J — No Jacks', unitLabel: 'Jacks' },
  H:  { label: '<3 — No Hearts', unitLabel: 'Hearts' },
  L2: { label: 'L2 — No Last 2', unitLabel: 'Last 2' },
  T:  { label: '- — No Tricks', unitLabel: 'Tricks' },
  P1: { label: '+ — Pluses (1)', unitLabel: 'Tricks' },
  P2: { label: '+ — Pluses (2)', unitLabel: 'Tricks' },
  P3: { label: '+ — Pluses (3)', unitLabel: 'Tricks' },
}

export const GAME_TYPES = GAME_TYPE_RULES.map(rule => ({ ...rule, ...LABELS[rule.code] }))
