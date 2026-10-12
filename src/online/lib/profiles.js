import { api } from './api'

const ACTIVE_KEY = 'king.profiles.active'

// ── Active (locked-in) profile ──────────────────────────────────────────────
export function getActiveProfileId() {
  try { return localStorage.getItem(ACTIVE_KEY) || null }
  catch { return null }
}

export function setActiveProfileId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id)
    else    localStorage.removeItem(ACTIVE_KEY)
  } catch { /* private mode — non-fatal */ }
}

export function clearActiveProfile() { setActiveProfileId(null) }

export function isProfileVerified(id) {
  if (!id) return false
  return getActiveProfileId() === id
}

export function markProfileVerified(id) {
  if (id) setActiveProfileId(id)
}

export function forgetProfileVerification(id) {
  if (!id || getActiveProfileId() === id) clearActiveProfile()
}

// ── Server-backed CRUD ──────────────────────────────────────────────────────
export const listProfiles = ()   => api.listProfiles()
export const getProfile   = (id) => api.getProfile(id)

export async function saveProfile({ id, name, avatar, pin }) {
  const profileId = id || `p_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const saved = await api.saveProfile(profileId, {
    name,
    avatar: avatar || null,
    ...(pin === undefined ? {} : { pin }),
  })

  if (typeof pin === 'string' && pin.length === 4) markProfileVerified(saved.id)
    
  if (pin === '') forgetProfileVerification(saved.id)
  return saved
}

export const deleteProfile = (id) => api.deleteProfile(id)

// ── PIN verify (server-backed) ──────────────────────────────────────────────
export async function verifyPin(id, pin) {
  const out = await api.verifyProfilePin(id, pin)
  if (out.ok) markProfileVerified(id)
  return out
}

// ── File → downscaled JPEG data URL ─────────────────────────────────────────
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
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.onerror = reject
      img.src = reader.result
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
