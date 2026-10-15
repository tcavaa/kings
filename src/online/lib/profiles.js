import { api } from './api'

// The profile this browser plays as, with the session token the server issued
// when it was picked (PIN checked). The game server only lets a socket play
// under a PIN-protected name with that token.
const SESSION_KEY = 'king.profiles.session'
const LEGACY_KEY = 'king.profiles.active'   // bare id, before tokens existed
const lostListeners = new Set()

function readSession() {
  try {
    localStorage.removeItem(LEGACY_KEY)
    const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    return s?.id && s?.token ? s : null
  } catch { return null }
}

export const getActiveProfileId = () => readSession()?.id || null
export const getProfileToken = () => readSession()?.token || null

function setProfileSession(id, token) {
  try {
    if (id && token) localStorage.setItem(SESSION_KEY, JSON.stringify({ id, token }))
    else localStorage.removeItem(SESSION_KEY)
  } catch { /* private mode — the profile just has to be picked again */ }
}

export function clearActiveProfile() { setProfileSession(null) }

/** The server refused our token: forget it and tell the lobby. */
export function dropProfileSession() {
  clearActiveProfile()
  lostListeners.forEach((fn) => fn())
}

export function onProfileSessionLost(fn) {
  lostListeners.add(fn)
  return () => lostListeners.delete(fn)
}

// ── Server-backed CRUD ──────────────────────────────────────────────────────
export const listProfiles = () => api.listProfiles()

/**
 * Create or edit a profile. `avatar`: a data URL sets the photo, null removes
 * it, undefined keeps it. `currentPin` is the profile's existing PIN — the
 * server refuses to change a PIN-protected profile without it.
 *
 * A new profile becomes the one this device plays as, and editing the active
 * one refreshes its session. Editing someone else's (fixing a friend's photo)
 * leaves the active profile alone.
 */
export async function saveProfile({ id, name, avatar, pin, currentPin }) {
  const profileId = id || `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const saved = await api.saveProfile(profileId, {
    name,
    ...(avatar === undefined ? {} : { avatar }),
    ...(pin === undefined ? {} : { pin }),
    ...(currentPin ? { currentPin } : {}),
  })
  if (!id || id === getActiveProfileId()) setProfileSession(saved.id, saved.token)
  return saved
}

export const deleteProfile = (id, currentPin) => api.deleteProfile(id, currentPin)

// ── PIN verify (server-backed) ──────────────────────────────────────────────
/** Pick a profile: checks the PIN ('' for a profile without one) and signs in. */
export async function verifyPin(id, pin) {
  const out = await api.verifyProfilePin(id, pin)
  if (out.ok) setProfileSession(id, out.token)
  return out
}

// Checks a PIN without switching this device to that profile (used before
// editing one).
export const checkPin = (id, pin) => api.verifyProfilePin(id, pin)

// ── File → small square photo data URL ─────────────────────────────────────
// A 256px square as WebP (about 4 KB, a quarter of the same JPEG), or JPEG
// where the browser can't encode WebP (it hands back PNG instead, which
// would be bigger, not smaller).
export async function fileToDataURL(file, maxSize = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const size = Math.min(maxSize, Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        const scale = size / Math.min(img.width, img.height)
        const sw = img.width * scale, sh = img.height * scale
        ctx.drawImage(img, (size - sw) / 2, (size - sh) / 2, sw, sh)
        const webp = canvas.toDataURL('image/webp', 0.8)
        resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
