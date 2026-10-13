import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * One send per tap. `run(fn)` calls `fn` only if nothing was sent in the
 * last `ms`, so a double tap on a contract, trump or next-round button emits
 * once instead of earning an error toast for the second. The screen holding
 * the button normally closes when the server answers; the lock lifts on its
 * own in case the answer was an error and the player needs to try again.
 */
export function useTapLock(ms = 4000) {
  const [locked, setLocked] = useState(false)
  // A ref as well as state: two taps can land before React re-renders.
  const timerRef = useRef(null)
  useEffect(() => () => clearTimeout(timerRef.current), [])
  const run = useCallback((fn) => {
    if (timerRef.current) return
    setLocked(true)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setLocked(false)
    }, ms)
    fn()
  }, [ms])
  return [locked, run]
}
