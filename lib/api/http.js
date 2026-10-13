// Shared plumbing for the route handlers that replaced King Online's Express
// API. Same validation, limits, status codes and error bodies as before —
// the client's fetch wrapper surfaces `{ error }` messages verbatim.
import crypto from 'node:crypto'
import store from '@/server/db/store'

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
  const status = err.status || (err.code === 'DB_NOT_CONFIGURED' ? 503 : 500)
  if (status >= 500) console.error('[api]', err.message)
  return json({ error: err.message }, status)
}

// ─── requests ───────────────────────────────────────────────────────────────

// Profile avatars are base64 data URLs of downscaled JPEGs (~30-40 KB each),
// so 1 MB gives generous headroom while still rejecting absurd uploads.
// Admin sound uploads are base64 audio and get 6 MB (well above the store's
// 2 MB audio cap, so an over-cap clip fails validation with a readable
// message rather than at the parser).
const BODY_LIMIT = 1024 * 1024
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

/** The caller's IP, as Vercel reports it (for guess limits). */
export function clientIp(request) {
  return (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown'
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

// pin_hash is hashed, but a 4-digit PIN is trivial to brute-force offline, so
// it never goes on the wire.
export function publicProfile(p) {
  if (!p) return p
  const { pin_hash: _ph, ...safe } = p
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

// There is no default: without ADMIN_PASSCODE (at least 8 characters) /admin
// stays locked.
const MIN_PASSCODE = 8
const ADMIN_GUESSES = { perIp: 10, overall: 100, windowSeconds: 15 * 60 }

function adminPasscode() {
  const pass = String(process.env.ADMIN_PASSCODE || '')
  return pass.length >= MIN_PASSCODE ? pass : null
}

function passcodeMatches(value) {
  const want = adminPasscode()
  if (!want) return false
  const given = Buffer.from(String(value ?? ''))
  const expected = Buffer.from(want)
  // timingSafeEqual throws on a length mismatch, so compare lengths first
  // (the length of the passcode isn't the secret).
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

/**
 * Check a passcode attempt, counting wrong ones per IP and overall so it
 * can't be guessed. Resolves to null when it's right, else the Response to
 * send.
 */
export async function checkAdmin(request, value) {
  if (!adminPasscode()) return json({ error: 'Admin is disabled: ADMIN_PASSCODE is not set.' }, 503)
  const { perIp, overall, windowSeconds } = ADMIN_GUESSES
  const ipKey = `admin:${clientIp(request)}`
  if (await store.isRateLimited(ipKey, perIp, windowSeconds)
      || await store.isRateLimited('admin:*', overall, windowSeconds)) {
    return json({ error: 'Too many wrong passcodes. Try again later.' }, 429)
  }
  if (passcodeMatches(value)) return null
  await store.recordFailure(ipKey, windowSeconds)
  await store.recordFailure('admin:*', windowSeconds)
  return json({ error: 'Wrong passcode' }, 401)
}

/** null when the request carries the right X-Admin-Pass, else the Response to send. */
export function requireAdmin(request) {
  return checkAdmin(request, request.headers.get('x-admin-pass'))
}

// ─── profile PINs ───────────────────────────────────────────────────────────

const PIN_GUESSES = { max: 8, windowSeconds: 15 * 60 }

/** The 429 to send when this profile's PIN has been guessed too often, else null. */
export async function pinLocked(profileId) {
  return await store.isRateLimited(`pin:${profileId}`, PIN_GUESSES.max, PIN_GUESSES.windowSeconds)
    ? json({ error: 'Too many wrong PINs. Try again in 15 minutes.' }, 429)
    : null
}

export function recordWrongPin(profileId) {
  return store.recordFailure(`pin:${profileId}`, PIN_GUESSES.windowSeconds)
}
