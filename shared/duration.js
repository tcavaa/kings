// Game clocks and saved game lengths, in both apps.

/**
 * "m:ss" under an hour, "h:mm:ss" above, from a number of seconds (rounded
 * to whole seconds, so a saved length reads the same as the clock that
 * timed it). Returns null for bad input.
 */
export function formatDuration(totalSeconds) {
  if (totalSeconds == null || isNaN(totalSeconds)) return null
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
