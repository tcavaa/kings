import { useCallback, useEffect, useRef } from 'react'
import { api } from '../lib/api'
import { getSounds, setSounds } from '../lib/soundRegistry'

/**
 * Play `a` muted and immediately stop it. Two jobs: it satisfies the browser's
 * autoplay policy for this element (so a later socket-driven .play() outside
 * a gesture is allowed), and the play attempt is what actually downloads the
 * file — the elements are created with preload="none" so page load doesn't
 * pull down the whole clip library.
 *
 * The element STAYS muted afterwards. It's only unmuted in the real playback
 * path; unmuting here used to race — a rejected or interrupted prime could
 * flip `muted` back off while another prime was still running, occasionally
 * blasting every clip at once on page load.
 */
function primeAudioEl(a) {
  try {
    a.muted = true
    const stop = () => { a.pause(); a.currentTime = 0 }
    const p = a.play()
    if (p && typeof p.then === 'function') {
      p.then(stop).catch(() => { /* stays muted & idle — never audible */ })
    } else {
      setTimeout(stop, 0)
    }
  } catch { /* ignore */ }
}

/**
 * The reaction clips other players trigger at the table.
 *
 * One reusable <audio> per clip, keyed by wire id. They have to be
 * constructed up front and primed inside a user gesture (`unlockAudio`) — a
 * freshly-constructed Audio() inside a socket callback is blocked by the
 * autoplay policy. `playClip(id)` plays one from a socket event.
 */
export function useReactionAudio(appPhase) {
  const audioElsRef = useRef(null)
  const audioUnlockedRef = useRef(false)
  // id -> the url its element was built from, so a clip whose audio an admin
  // replaced can be told apart from one that's unchanged.
  const audioUrlsRef = useRef({})

  // Build (or top up) the pool from whatever the registry currently holds.
  // Existing elements are kept as-is so a catalogue refresh never discards
  // an element that's already been unlocked.
  const syncAudioPool = useCallback(() => {
    if (typeof window === 'undefined') return
    const map = audioElsRef.current || {}
    for (const s of getSounds()) {
      // Compared on the url, not just the id: when an admin replaces a
      // clip's audio the id stays put but the url's `?v=` moves, and we want
      // the new bytes rather than the element still holding the old ones.
      if (map[s.id] && audioUrlsRef.current[s.id] === s.url) continue
      // Built-in urls carry a filename; `Male!` has a reserved URL character,
      // which the registry has already encoded.
      const a = new Audio(s.url)
      // 'none': don't fetch every clip during page load. The unlock pass
      // plays each element muted, which triggers the actual download — same
      // audible behavior, off the critical path.
      a.preload = 'none'
      a.volume = 0.7
      // Clips added after the unlock missed it, so prime them now — we're
      // outside a gesture, but the autoplay policy is per-document once it
      // has been satisfied.
      if (audioUnlockedRef.current) primeAudioEl(a)
      map[s.id] = a
      audioUrlsRef.current[s.id] = s.url
    }
    audioElsRef.current = map
  }, [])

  if (!audioElsRef.current && typeof window !== 'undefined') syncAudioPool()

  // Pull the live catalogue (admin-managed) and refresh the button lists +
  // audio pool. A failure leaves the built-in fallback in place.
  useEffect(() => {
    let cancelled = false
    api.listSounds()
      .then(list => {
        if (cancelled) return
        setSounds(list)
        syncAudioPool()
      })
      .catch(err => console.warn('[sounds] catalogue fetch failed:', err.message))
    return () => { cancelled = true }
  }, [syncAudioPool])

  // Prime every element inside a user gesture so later socket-driven
  // .play() calls are allowed by the autoplay policy (see primeAudioEl).
  // Each element is primed separately, because iOS needs exactly that.
  // Strictly once per session — no retry loop to interleave with itself.
  // The flag lets clips that arrive later (catalogue fetch resolving after
  // the click) prime themselves as they're created.
  //
  // Priming downloads the whole clip library (about 1.2 MB), so it waits for
  // a gesture that leads to a table — sitting down, creating, joining or
  // watching one (those actions call this) — rather than the first tap
  // anywhere on the homepage.
  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current || typeof window === 'undefined') return
    audioUnlockedRef.current = true
    Object.values(audioElsRef.current || {}).forEach(primeAudioEl)
  }, [])

  // Already at a table without one of those clicks (a refresh mid-game, a
  // tournament seating us): the first tap anywhere unlocks it.
  useEffect(() => {
    if (typeof window === 'undefined' || appPhase === 'lobby' || audioUnlockedRef.current) return
    const unlock = () => unlockAudio()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown',     unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown',     unlock)
    }
  }, [appPhase, unlockAudio])

  // Reuse the element unlocked by the gesture — a freshly-constructed
  // Audio() would be blocked, because this runs inside a socket event.
  const playClip = useCallback((soundId) => {
    const a = audioElsRef.current?.[soundId]
    if (!a) return
    try {
      a.pause()
      a.currentTime = 0
      // Elements are kept muted after the unlock priming pass — unmute
      // only here, in the real playback path.
      a.muted = false
      a.volume = 0.7
      a.play().catch(() => { /* still blocked — needs a fresh gesture */ })
    } catch { /* ignore */ }
  }, [])

  return { unlockAudio, playClip }
}
