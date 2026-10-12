// Shared plumbing for the route handlers that replaced King Online's Express
// API. Same validation, limits, status codes and error bodies as before —
// the client's fetch wrapper surfaces `{ error }` messages verbatim.
import crypto from 'node:crypto'

// ─── responses ──────────────────────────────────────────────────────────────

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  })
}

/**
 * A JSON array, streamed. Finished-game lists carry every player's base64
 * avatar and run to many megabytes; Vercel caps a buffered function response
 * at 4.5 MB but not a streamed one. The bytes are exactly
 * JSON.stringify(items).
 */
export function jsonArray(items, status = 200) {
  const enc = new TextEncoder()
  let i = 0
  const stream = new ReadableStream({
    pull(controller) {
      let chunk = i === 0 ? '[' : ''
      for (let n = 0; n < 20 && i < items.length; n++, i++) {
        chunk += (i ? ',' : '') + JSON.stringify(items[i])
      }
      if (i >= items.length) chunk += ']'
      controller.enqueue(enc.encode(chunk))
      if (i >= items.length) controller.close()
    },
  })
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export function sendErr(err) {
  const status = err.status
    || (err.code === 'FORBIDDEN'           ? 403
    :   err.code === 'DB_NOT_CONFIGURED'   ? 503
    :   500)
  if (status >= 500) console.error('[api]', err.message)
  return json({ error: err.message }, status)
}

// ─── requests ───────────────────────────────────────────────────────────────

// Profile avatars are base64 data URLs of downscaled JPEGs (~30-40 KB each),
// so 1 MB gives generous headroom while still rejecting absurd uploads.
// Admin sound uploads are base64 audio and get 6 MB (well above the store's
// 2 MB audio cap, so an over-cap clip fails validation with a readable
// message rather than at the parser).
export const BODY_LIMIT = 1024 * 1024
export const UPLOAD_LIMIT = 6 * 1024 * 1024

function bodyError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/** express.json(): `{}` for a non-JSON or empty body, 400 / 413 on bad input. */
export async function readJson(request, limit = BODY_LIMIT) {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) throw bodyError(413, 'Upload is too large.')
  const text = await request.text()
  if (Buffer.byteLength(text) > limit) throw bodyError(413, 'Upload is too large.')
  const type = request.headers.get('content-type') || ''
  if (!/\bjson\b/i.test(type) || !text.trim()) return {}
  let body
  try { body = JSON.parse(text) } catch { throw bodyError(400, 'Malformed JSON body.') }
  // body-parser's strict mode: only objects and arrays.
  if (body === null || typeof body !== 'object') throw bodyError(400, 'Malformed JSON body.')
  return body
}

// `X-Device-Key` identifies the browser that created a profile. Absent or
// oversized → no claim.
export function deviceKey(request) {
  const k = request.headers.get('x-device-key')
  return (typeof k === 'string' && k.length > 0 && k.length <= 128) ? k : null
}

// Normalise a `?mode=` query into 'championship' | 'public' | 'all'.
export function parseMode(value, fallback) {
  return value === 'championship' || value === 'public' || value === 'all'
    ? value
    : fallback
}

// Normalise a `?type=` query into 'online' | 'live' | 'all' (King Online games,
// games recorded in ჩაწერა, or both).
export function parseType(value, fallback) {
  return value === 'online' || value === 'live' || value === 'all'
    ? value
    : fallback
}

// URLSearchParams gives null for a missing key; Express gave undefined, which
// is what lets the store's default parameters kick in.
export function query(request, key) {
  const v = new URL(request.url).searchParams.get(key)
  return v === null ? undefined : v
}

// ─── profiles ───────────────────────────────────────────────────────────────

// Strip server-only fields that should never go on the wire (pin_hash is
// hashed but it's still a brute-force target on a 4-digit input — never expose
// it; device_key identifies the owning browser and isn't useful to any other
// client either).
export function publicProfile(p) {
  if (!p) return p
  const { device_key: _dk, pin_hash: _ph, ...safe } = p
  return safe
}

const MAX_AVATAR_BYTES = 200 * 1024        // ≤200 KB after base64 → ~150 KB JPEG
const AVATAR_DATA_URL  = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/=]+)$/
const MAGIC = {
  jpeg: ['ffd8ff'],
  png:  ['89504e470d0a1a0a'],
  webp: ['52494646'],         // 'RIFF' (followed by '...WEBP'); we only sniff the leading bytes
}

export function validateAvatar(input) {
  if (input == null) return null // explicit "no avatar"
  if (typeof input !== 'string') throw bodyError(400, 'avatar must be a data URL string')
  const m = AVATAR_DATA_URL.exec(input)
  if (!m) throw bodyError(400, 'avatar must be a data URL of an image (jpeg/png/webp)')
  let mime = m[1].toLowerCase(); if (mime === 'jpg') mime = 'jpeg'
  const b64  = m[2]
  const len  = Math.floor(b64.length * 3 / 4)
  if (len > MAX_AVATAR_BYTES) throw bodyError(413, 'avatar is too large (max 200 KB)')
  // Magic-byte sniff to make sure the data really is what the mime claims.
  const buf = Buffer.from(b64, 'base64')
  const head = buf.subarray(0, 8).toString('hex')
  const ok = (MAGIC[mime] || []).some(sig => head.startsWith(sig))
  if (!ok) throw bodyError(400, 'avatar bytes do not match its declared image type')
  return input
}

// ─── /admin ─────────────────────────────────────────────────────────────────

// The /admin passcode — a "keep the other players out of the sound board"
// latch, not an authentication system. Set ADMIN_PASSCODE in production.
function adminPasscode() {
  return String(process.env.ADMIN_PASSCODE || '2282')
}

export function checkAdminPass(value) {
  const given = Buffer.from(String(value ?? ''))
  const want  = Buffer.from(adminPasscode())
  // timingSafeEqual throws on a length mismatch, so compare lengths first
  // (the length of the passcode isn't the secret).
  return given.length === want.length && crypto.timingSafeEqual(given, want)
}

/** null when the request carries the passcode, else the 401 to return. */
export function requireAdmin(request) {
  if (checkAdminPass(request.headers.get('x-admin-pass'))) return null
  return json({ error: 'Wrong passcode' }, 401)
}
