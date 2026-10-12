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
    audio = new Audio(url)
    currentUrl = url
    audio.onended = () => { currentUrl = null; notify() }
    audio.onerror = () => { currentUrl = null; notify() }
    audio.play().catch(() => { currentUrl = null; notify() })
    notify()
  },

  stop() {
    if (audio) {
      audio.pause()
      audio.currentTime = 0
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
