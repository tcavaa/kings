/**
 * CSS class for a score value: vine-green positive, wine-red negative,
 * caller-chosen neutral (sites use different muted inks for zero).
 * The pos/neg classes live in styles/index.css.
 */
export function scoreColorClass(v, neutral = 'text-cream-dim') {
  return v > 0 ? 'score-pos-soft' : v < 0 ? 'score-neg-soft' : neutral
}
