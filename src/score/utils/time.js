/** "m:ss" under an hour, "h:mm:ss" above. Returns null for bad input. */
export function formatDuration(totalSeconds) {
  if (totalSeconds == null || isNaN(totalSeconds)) return null
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const ss = String(sec).padStart(2, '0')
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`
  return `${m}:${ss}`
}
