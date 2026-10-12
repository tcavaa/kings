// Tiny REST client that talks to the app's /api routes (Next.js, same
// origin) — plus the address of the live game server for socket.io.
//
// Every mutating request carries a stable per-browser device key so the
// server can scope profile edits/deletes to the device that created them.

// REST lives on the page's own origin, so an empty base makes fetch use it.
// NEXT_PUBLIC_API_URL only exists to point a dev build at another deployment.
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/+$/, '')

// The Socket.IO game server runs on its own host (it needs a long-lived
// process). Precedence:
//   1. NEXT_PUBLIC_SOCKET_URL (build-time env, e.g. https://kings-game.onrender.com)
//   2. Same hostname as the page on :3001 (local dev, incl. a phone on the LAN)
function defaultSocketBase() {
  if (typeof window === 'undefined') return 'http://localhost:3001'
  const { protocol, hostname } = window.location
  return `${protocol === 'https:' ? 'https:' : 'http:'}//${hostname || 'localhost'}:3001`
}

export const SOCKET_URL = (process.env.NEXT_PUBLIC_SOCKET_URL || defaultSocketBase()).replace(/\/+$/, '')

const DEVICE_KEY_STORAGE = 'king.device.key.v1'

export function getDeviceKey() {
  let k = ''
  try { k = localStorage.getItem(DEVICE_KEY_STORAGE) || '' } catch { /* private mode */ }
  if (!k) {
    k = `dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`
    try { localStorage.setItem(DEVICE_KEY_STORAGE, k) } catch { /* ignore */ }
  }
  return k
}

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const isWrite = method !== 'GET' && method !== 'HEAD'

  // Only send custom headers on writes. A GET with `Content-Type:
  // application/json` and a custom `X-Device-Key` triggers a CORS preflight
  // in every browser; if the host swallows the OPTIONS request (some cPanel
  // / LiteSpeed setups do), the GET is silently blocked and the lobby ends
  // up showing zero profiles. Plain GET with no extra headers is a "simple"
  // CORS request and skips preflight entirely.
  const headers = {
    ...(isWrite ? {
      'Content-Type': 'application/json',
      'X-Device-Key': getDeviceKey(),
    } : {}),
    ...(options.headers || {}),
  }
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    let body = ''
    try { body = await res.text() } catch { /* ignore */ }
    const msg = body ? safeMessage(body) : res.statusText
    throw new Error(`HTTP ${res.status}: ${msg}`)
  }
  if (res.status === 204) return null
  return res.json()
}

function safeMessage(body) {
  try { const j = JSON.parse(body); return j.error || body } catch { return body }
}

export const api = {
  // profiles
  listProfiles:  ()           => request('/api/profiles'),
  getProfile:    (id)         => request(`/api/profiles/${encodeURIComponent(id)}`),
  saveProfile:   (id, body)   => request(`/api/profiles/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify(body),
  }),
  deleteProfile: (id, currentPin) => request(`/api/profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE', body: JSON.stringify({ currentPin }),
  }),
  // PIN check — returns { ok: true, hadPin } on success.  On a wrong PIN the
  // server replies 401 → request() throws an Error whose .message contains
  // "HTTP 401". We surface that as { ok: false } so callers can render a
  // toast without try/catching.
  verifyProfilePin: async (id, pin) => {
    try {
      const out = await request(`/api/profiles/${encodeURIComponent(id)}/verify-pin`, {
        method: 'POST', body: JSON.stringify({ pin }),
      })
      return { ok: !!out?.ok, hadPin: !!out?.hadPin }
    } catch (err) {
      const msg = err?.message || ''
      if (msg.includes('HTTP 401')) return { ok: false, hadPin: true, reason: 'bad_pin' }
      if (msg.includes('HTTP 404')) return { ok: false, hadPin: false, reason: 'not_found' }
      throw err
    }
  },

  // games (read + append; bulk delete intentionally not supported)
  listGames: (limit = 50)     => request(`/api/games?limit=${limit}`),
  getGame:   (id)             => request(`/api/games/${encodeURIComponent(id)}`),
  saveGame:  (record)         => request('/api/games', {
    method: 'POST', body: JSON.stringify(record),
  }),

  // stats — per-player lifetime counters computed server-side from every
  // stored game's roundDetails JSON.
  // King Score's seasons, for the leaderboard's seasons tab.
  listSeasons: () => request('/api/seasons'),
  getLifetimeStats: (name, type = 'all') =>
    request(`/api/stats/${encodeURIComponent(name)}?type=${encodeURIComponent(type)}`),

  // championship daily quota — { name, limit, playedToday, remaining }.
  getChampionshipQuota: (name) => request(`/api/quota/${encodeURIComponent(name)}`),

  // reaction-sound catalogue — [{ id, label, glyph, color, url }]. Public
  // read; the write side lives in `adminApi` below.
  listSounds: () => request('/api/sounds'),
}

// ─── /admin ─────────────────────────────────────────────────────────────────
// The sound-management page. Every call carries the passcode as a header —
// there's no session or cookie, the page just holds the code in memory (and
// sessionStorage) for as long as the tab is open.
function adminRequest(passcode, path, options = {}) {
  return request(path, {
    ...options,
    headers: { ...(options.headers || {}), 'X-Admin-Pass': passcode },
  })
}

export const adminApi = {
  // Returns true/false rather than throwing on a bad passcode — the login
  // screen wants to show "wrong code", not an HTTP error.
  login: async (passcode) => {
    try {
      const out = await request('/api/admin/login', {
        method: 'POST', body: JSON.stringify({ passcode }),
      })
      return !!out?.ok
    } catch (err) {
      if ((err?.message || '').includes('HTTP 401')) return false
      throw err
    }
  },
  listSounds:  (passcode)            => adminRequest(passcode, '/api/admin/sounds'),
  createSound: (passcode, body)      => adminRequest(passcode, '/api/admin/sounds', {
    method: 'POST', body: JSON.stringify(body),
  }),
  updateSound: (passcode, id, body)  => adminRequest(passcode, `/api/admin/sounds/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify(body),
  }),
  deleteSound: (passcode, id)        => adminRequest(passcode, `/api/admin/sounds/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
  // ids = the whole catalogue in its new front-to-back order.
  reorderSounds: (passcode, ids)     => adminRequest(passcode, '/api/admin/sounds/reorder', {
    method: 'POST', body: JSON.stringify({ ids }),
  }),
}
