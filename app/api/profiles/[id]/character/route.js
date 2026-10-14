import store from '@/server/db/store'
import {
  json, pinLocked, readJson, recordWrongPin, sendErr, UPLOAD_LIMIT, validateHeadGlb,
} from '@/lib/api/http'

// A profile's look at the 3D table: { gender, head: url|null }.
export async function GET(_request, { params }) {
  try {
    const { id } = await params
    return json(await store.getCharacter(id))
  } catch (err) { return sendErr(err) }
}

// Owner-only: { gender?, head?: base64 GLB | null, currentPin }.
export async function PUT(request, { params }) {
  try {
    const { id } = await params
    const { gender, head, currentPin } = (await readJson(request, UPLOAD_LIMIT)) || {}
    const locked = await pinLocked(id)
    if (locked) return locked
    let saved
    try {
      saved = await store.saveCharacter({
        id,
        gender,
        head: head === undefined ? undefined : validateHeadGlb(head),
        currentPin,
      })
    } catch (err) {
      if (err.status === 403) await recordWrongPin(id)
      throw err
    }
    if (!saved) return json({ error: 'Profile not found' }, 404)
    return json(saved)
  } catch (err) { return sendErr(err) }
}
