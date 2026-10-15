// A small browser router for both apps (browser only). Each screen has its
// own address, so a page can be shared and the browser's Back button steps
// back through the site instead of leaving it.
//
// It works on the plain History API rather than Next's router: both apps are
// one client component under a catch-all page, and a Next navigation would
// remount it (King Online would drop its game socket). Next keeps its own
// router in step with pushState/replaceState calls, so the two get along.

import { useMemo, useSyncExternalStore } from 'react'

const listeners = new Set()
const notify = () => listeners.forEach((l) => l())

function subscribe(listener) {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener('popstate', notify)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener('popstate', notify)
  }
}

const currentUrl = () => window.location.pathname + window.location.search

// How many of this site's pages are behind the current one in this tab, kept
// in the history entry itself so a reload remembers it.
const depthOf = (state) => (Number.isInteger(state?.kingDepth) ? state.kingDepth : 0)

/** Go to `to` (a path, optionally with ?query). `replace` swaps the current entry. */
export function navigate(to, { replace = false } = {}) {
  if (to === currentUrl()) return
  const depth = depthOf(window.history.state)
  if (replace) {
    window.history.replaceState({ ...window.history.state, kingDepth: depth }, '', to)
  } else {
    window.history.pushState({ kingDepth: depth + 1 }, '', to)
    window.scrollTo(0, 0)
  }
  notify()
}

/**
 * An in-app Back button: the previous page when it is one of ours (the same
 * as the browser's Back), otherwise `fallback` (a page opened from a shared
 * link has nothing of ours behind it).
 */
export function goBack(fallback) {
  if (depthOf(window.history.state) > 0) window.history.back()
  else navigate(fallback, { replace: true })
}

/** Change only the query string, in place (filters and the like). */
export function setQuery(key, value) {
  const url = new URL(window.location.href)
  if (value == null || value === '') url.searchParams.delete(key)
  else url.searchParams.set(key, value)
  navigate(url.pathname + url.search, { replace: true })
}

/**
 * The current address, re-rendering on every change:
 *   { path, segments: decoded path parts, query: URLSearchParams }
 * `base` is stripped from the front of the segments ('/score' → [] for /score).
 */
export function useLocation(base = '') {
  const url = useSyncExternalStore(subscribe, currentUrl, () => base || '/')
  return useMemo(() => {
    const [pathname, search = ''] = url.split('?')
    const rest = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname
    const segments = rest.split('/').filter(Boolean).map((s) => {
      try { return decodeURIComponent(s) } catch { return s }
    })
    return { path: pathname, segments, query: new URLSearchParams(search) }
  }, [url, base])
}

/** A path from parts, each one encoded: pathOf('/leaderboard', 'player', name). */
export function pathOf(base, ...parts) {
  return [base, ...parts.filter((p) => p != null && p !== '').map((p) => encodeURIComponent(p))].join('/')
}
