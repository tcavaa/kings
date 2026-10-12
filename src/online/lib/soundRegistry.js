// Live view of the reaction-clip catalogue.
//
// The catalogue is now a server table an admin edits at /admin, so the three
// consumers that used to import the hardcoded `SOUNDS` array — the Phaser
// avatar buttons, the DOM sound board, and GameContext's pool of unlocked
// <audio> elements — read it from here instead. GameContext fetches
// /api/sounds once on mount and pushes the result in.
//
// Until that lands (and forever, if the request fails or the DB is down) the
// hardcoded list is what's served: the built-in clips ship inside the
// front-end build, so they play with or without a server catalogue.

import { SOUNDS as BUILTIN_SOUNDS } from '../constants/sounds'
import { API_BASE } from './api'

/**
 * Make a catalogue url loadable from wherever the page happens to be served.
 *
 * Built-in clips are static files inside the front-end build, so they stay
 * relative to the page. Uploaded clips are served by the API, which is NOT
 * always the page's origin: in dev the page is on :5173 while the API is on
 * :3001 (and vite only proxies /socket.io, not /api), and a deployment can
 * point VITE_API_URL at a separate host. Left relative, those requests hit
 * the SPA fallback and come back as index.html — an <audio> element handed
 * HTML just fails silently, which is exactly what "the new buttons make no
 * sound" looked like.
 */
const resolveUrl = (u) => (u.startsWith('/api/') ? `${API_BASE}${u}` : u)

// Normalised entry: { id, label, glyph, color, url }.
const withUrls = (list) => list.map(s => ({
  ...s,
  url: resolveUrl(s.url || `/sounds/${encodeURIComponent(s.id)}.mp3`),
}))

let sounds = withUrls(BUILTIN_SOUNDS)
const listeners = new Set()

export function getSounds() {
  return sounds
}

/** Replace the catalogue. Ignores an empty list — that's a broken fetch, not
 *  an admin who deleted every clip's worth of taking the buttons away. */
export function setSounds(list) {
  if (!Array.isArray(list) || list.length === 0) return
  sounds = withUrls(list)
  listeners.forEach(fn => { try { fn(sounds) } catch { /* one bad listener shouldn't stop the rest */ } })
}

/** Subscribe to catalogue changes; returns an unsubscribe fn. */
export function subscribeSounds(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
