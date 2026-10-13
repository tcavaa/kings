// Module-level owner of voice-message playback. The Audio element lives
// OUTSIDE the React tree so closing the chat drawer (which unmounts the
// bubbles) doesn't cut a clip off mid-play. One clip at a time — starting
// another stops the current one.

let audio = null
let currentUrl = null
const listeners = new Set()

function notify() {
  listeners.forEach(fn => fn(currentUrl))
}

export const voicePlayer = {
  /** Play `url`, or stop it if it's already the one playing. */
  toggle(url) {
    if (currentUrl === url && audio && !audio.paused) {
      this.stop()
      return
    }
    this.stop()
    const el = new Audio(url)
    audio = el
    currentUrl = url
    // Each callback checks it still belongs to the current clip: switching
    // clips while the first is loading rejects its play(), and that late
    // rejection must not mark the second clip as stopped.
    const done = () => {
      if (audio !== el) return
      currentUrl = null
      notify()
    }
    el.onended = done
    el.onerror = done
    el.play().catch(done)
    notify()
  },

  stop() {
    if (audio) {
      audio.onended = null
      audio.onerror = null
      audio.pause()
      audio.currentTime = 0
      audio = null
    }
    currentUrl = null
    notify()
  },

  /** URL of the clip currently playing, or null. */
  playingUrl() {
    return currentUrl
  },

  /** Subscribe to playing-url changes; returns an unsubscribe fn. */
  subscribe(fn) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
}
