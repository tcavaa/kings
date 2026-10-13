import { useEffect } from 'react'

/**
 * Keeps the screen awake while `active` (a game in progress).
 *
 * The browser releases a screen wake lock whenever the page is hidden, so
 * the lock is asked for again each time the page becomes visible. The
 * `release` listener forgets a lock the browser dropped; without it the
 * stale object looked held, and after one app switch the phone dimmed and
 * slept for the rest of the game.
 */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return
    let lock = null
    let requesting = false
    let cancelled = false
    const acquire = async () => {
      if (lock || requesting || document.visibilityState !== 'visible') return
      requesting = true
      try {
        const next = await navigator.wakeLock.request('screen')
        if (cancelled) { next.release().catch(() => {}); return }
        lock = next
        next.addEventListener('release', () => { if (lock === next) lock = null })
      } catch {
        /* battery saver, or the page was hidden meanwhile — fine */
      } finally {
        requesting = false
      }
    }
    acquire()
    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (lock) lock.release().catch(() => {})
      lock = null
    }
  }, [active])
}
