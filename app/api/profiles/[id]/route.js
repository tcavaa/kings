import store from '@/server/db/store'
import {
  json, pinLocked, publicProfile, readJson, recordWrongPin, sendErr, validateAvatar,
} from '@/lib/api/http'

// Create or edit a profile. Editing one with a PIN needs `currentPin`; a
// successful save returns a session token, since the caller just proved it
// owns the profile. `avatar` left out keeps the photo, null removes it.
export async function PUT(request, { params }) {
  try {
    const { id } = await params
    const { name, avatar, pin, currentPin } = (await readJson(request)) || {}
    if (typeof name !== 'string' || !name.trim()) {
      return json({ error: 'name is required' }, 400)
    }
    const locked = await pinLocked(id)
    if (locked) return locked
    const saved = await guardPin(id, () => store.upsertProfile({
      id,
      name,
      avatar: avatar === undefined ? undefined : validateAvatar(avatar),
      pin,
      currentPin,
    }))
    return json({ ...publicProfile(saved), token: await store.createProfileSession(id) })
  } catch (err) { return sendErr(err) }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    const { currentPin } = (await readJson(request)) || {}
    const locked = await pinLocked(id)
    if (locked) return locked
    const ok = await guardPin(id, () => store.deleteProfile(id, currentPin))
    if (!ok) return json({ error: 'Profile not found' }, 404)
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}

// A wrong `currentPin` counts toward the same guess limit as verify-pin.
async function guardPin(id, fn) {
  try {
    return await fn()
  } catch (err) {
    if (err.status === 403) await recordWrongPin(id)
    throw err
  }
}
