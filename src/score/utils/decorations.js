import { GAME_TYPES } from '../constants/gameTypes'

// Truly random theme decorations for the IN-GAME blocks (Game Types
// Availability cells + "Choose a game type" buttons). Rolled ONCE per page
// load at module init, so every visit scatters the moss/fish/lilies/snow
// differently — but nothing jumps around mid-session or between re-renders.
// Variant 'a' and 'b' pick between the two looks each theme defines in CSS
// (left/right moss, fish/lily, left/right snow tuft).
//
// Cards elsewhere keep their fixed nth-child scatter on purpose.

const variant = () => (Math.random() < 0.5 ? 'a' : 'b')

/** { [gameTypeCode]: 'a' | 'b' } — which chooser buttons get a decoration. */
export const TYPE_BTN_DECOR = (() => {
  const map = {}
  GAME_TYPES.forEach(t => {
    if (Math.random() < 0.33) map[t.code] = variant()
  })
  return map
})()

/**
 * { [`${gameTypeCode}-${playerIndex}`]: 'a' | 'b' } — which availability
 * cells get a decoration (rolled for up to 4 player columns).
 */
export const MATRIX_CELL_DECOR = (() => {
  const map = {}
  GAME_TYPES.forEach(t => {
    for (let col = 0; col < 4; col++) {
      if (Math.random() < 0.14) map[`${t.code}-${col}`] = variant()
    }
  })
  return map
})()
