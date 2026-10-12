import store from '@/server/db/store'
import {
  deviceKey, json, publicProfile, readJson, sendErr, validateAvatar,
} from '@/lib/api/http'

export async function GET(_request, { params }) {
  try {
    const { id } = await params
    const p = await store.getProfile(id)
    if (!p) return json({ error: 'Profile not found' }, 404)
    return json(publicProfile(p))
  } catch (err) { return sendErr(err) }
}

export async function PUT(request, { params }) {
  try {
    const { id } = await params
    const { name, avatar, pin, currentPin } = (await readJson(request)) || {}
    if (typeof name !== 'string' || !name.trim()) {
      return json({ error: 'name is required' }, 400)
    }
    const cleanAvatar = validateAvatar(avatar)
    // Pass pin straight through — the store decides whether to keep, set, or
    // clear it (undefined = keep, '' = clear, '1234' = set).
    const saved = await store.upsertProfile({
      id,
      name,
      avatar: cleanAvatar,
      deviceKey: deviceKey(request),
      pin,
      // Required when the profile already has a PIN (403 otherwise).
      currentPin,
    })
    return json(publicProfile(saved))
  } catch (err) { return sendErr(err) }
}

export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    const { currentPin } = (await readJson(request)) || {}
    const ok = await store.deleteProfile(id, currentPin)
    if (!ok) return json({ error: 'Profile not found' }, 404)
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
