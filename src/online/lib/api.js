// Tiny REST client that talks to the app's /api routes (Next.js, same
// origin) — plus the address of the live game server for socket.io.

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

// This browser's own secret, sent to the game server when the socket
// connects. Seats are bound to it, so a refresh takes its seat back and
// nobody else can. Never sent anywhere else.
const CLIENT_KEY_STORAGE = 'king.client.key'

export function getClientKey() {
  let k = ''
  try { k = localStorage.getItem(CLIENT_KEY_STORAGE) || '' } catch { /* private mode */ }
  if (!k) {
    const bytes = new Uint8Array(24)
    crypto.getRandomValues(bytes)
    k = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    try { localStorage.setItem(CLIENT_KEY_STORAGE, k) } catch { /* ignore */ }
  }
  return k
}

/**
 * A failed API call. `status` is the HTTP status (0 when the server never
 * answered), `message` is Georgian and safe to show, and `serverMessage` is
 * the server's own (English) text, for the admin page and the console.
 */
export class ApiError extends Error {
  constructor(status, message, serverMessage = '') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.serverMessage = serverMessage
  }
}

const GEORGIAN_ERRORS = {
  400: 'მონაცემები არასწორია.',
  401: 'კოდი არასწორია.',
  403: 'ამის უფლება არ გაქვს.',
  404: 'ვერ მოიძებნა.',
  409: 'ასეთი სახელი უკვე არსებობს.',
  413: 'ფაილი ძალიან დიდია.',
  429: 'ძალიან ბევრი მცდელობა — სცადე მოგვიანებით.',
}
const georgianFor = (status) =>
  GEORGIAN_ERRORS[status] || (status >= 500 ? 'სერვერის შეცდომა — სცადე მოგვიანებით.' : 'მოთხოვნა ვერ შესრულდა.')

// A request that hangs (a cold database, a dead network) fails instead of
// leaving a spinner up forever. Writes carry uploads, so they get longer.
const READ_TIMEOUT_MS = 20 * 1000
const WRITE_TIMEOUT_MS = 60 * 1000

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  const isWrite = method !== 'GET' && method !== 'HEAD'

  // Only send a JSON content type on writes, so a GET stays a "simple"
  // request with no CORS preflight.
  const headers = {
    ...(isWrite ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers || {}),
  }
  const signal = options.signal
    ?? (typeof AbortSignal !== 'undefined' && AbortSignal.timeout
      ? AbortSignal.timeout(isWrite ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS)
      : undefined)
  let res
  try {
    res = await fetch(`${API_BASE}${path}`, { ...options, headers, signal })
  } catch (err) {
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    throw new ApiError(0, timedOut
      ? 'სერვერი არ პასუხობს — სცადე ხელახლა.'
      : 'სერვერთან კავშირი ვერ დამყარდა.', err?.message || '')
  }
  if (!res.ok) {
    let body = ''
    try { body = await res.text() } catch { /* ignore */ }
    const serverMessage = body ? safeMessage(body) : res.statusText
    throw new ApiError(res.status, georgianFor(res.status), serverMessage)
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
  saveProfile:   (id, body)   => request(`/api/profiles/${encodeURIComponent(id)}`, {
    method: 'PUT', body: JSON.stringify(body),
  }),
  // 3D looks: { [profileId]: { gender, head: url|null } }
  getCharacters: (ids)        => request(`/api/characters?ids=${ids.map(encodeURIComponent).join(',')}`),
  getCharacter:  (id)         => request(`/api/profiles/${encodeURIComponent(id)}/character`),
  saveCharacter: (id, body)   => request(`/api/profiles/${encodeURIComponent(id)}/character`, {
    method: 'PUT', body: JSON.stringify(body),
  }),
  deleteProfile: (id, currentPin) => request(`/api/profiles/${encodeURIComponent(id)}`, {
    method: 'DELETE', body: JSON.stringify({ currentPin }),
  }),
  // PIN check — returns { ok: true, hadPin, token } on success (the token
  // signs this browser in as the profile). A wrong PIN (401), too many tries
  // (429) and a profile that's gone (404) come back as { ok: false, reason }
  // so callers can show a message without try/catching.
  verifyProfilePin: async (id, pin) => {
    try {
      const out = await request(`/api/profiles/${encodeURIComponent(id)}/verify-pin`, {
        method: 'POST', body: JSON.stringify({ pin }),
      })
      return { ok: !!out?.ok, hadPin: !!out?.hadPin, token: out?.token || null }
    } catch (err) {
      if (err?.status === 429) return { ok: false, hadPin: true, reason: 'locked' }
      if (err?.status === 401) return { ok: false, hadPin: true, reason: 'bad_pin' }
      if (err?.status === 404) return { ok: false, hadPin: false, reason: 'not_found' }
      throw err
    }
  },

  // Finished games (read only — the game server saves them). Players' photos
  // are left out: the leaderboard shows each player's current profile photo.
  listGames: (limit = 50, { rounds = true } = {}) =>
    request(`/api/games?limit=${limit}&avatars=0${rounds ? '' : '&rounds=0'}`),
  // One game with its rounds, without photos.
  getGame: (id) => request(`/api/games/${encodeURIComponent(id)}`),

  // King Score's seasons, for the leaderboard's seasons tab.
  listSeasons: () => request('/api/seasons'),
  // stats — per-player lifetime counters computed server-side from every
  // stored game's roundDetails JSON.
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
      if (err?.status === 401) return false
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

  // Seasons: ending one (the server works out the champion), renaming and
  // re-theming the current one.
  listSeasons:   ()                  => request('/api/seasons'),
  previewSeasonEnd: (passcode)       => adminRequest(passcode, '/api/seasons', {
    method: 'POST', body: JSON.stringify({ action: 'preview' }),
  }),
  endSeason:     (passcode, body)    => adminRequest(passcode, '/api/seasons', {
    method: 'POST', body: JSON.stringify({ action: 'end', ...body }),
  }),
  updateSeason:  (passcode, body)    => adminRequest(passcode, '/api/seasons', {
    method: 'PATCH', body: JSON.stringify(body),
  }),

  // Players (the profiles both apps share).
  listPlayers:   ()                  => request('/api/players'),
  addPlayer:     (passcode, name)    => adminRequest(passcode, '/api/players', {
    method: 'POST', body: JSON.stringify({ name }),
  }),
  deletePlayer:  (passcode, id)      => adminRequest(passcode, `/api/players/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }),
  clearPlayerPin: (passcode, id)     => adminRequest(passcode, `/api/players/${encodeURIComponent(id)}`, {
    method: 'POST', body: JSON.stringify({ action: 'clear-pin' }),
  }),
  setPlayerPin:  (passcode, id, pin) => adminRequest(passcode, `/api/players/${encodeURIComponent(id)}`, {
    method: 'POST', body: JSON.stringify({ action: 'set-pin', pin }),
  }),
}
