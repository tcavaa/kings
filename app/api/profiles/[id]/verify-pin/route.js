import store from '@/server/db/store'
import { json, pinLocked, readJson, recordWrongPin, sendErr } from '@/lib/api/http'

// Picking a profile in the lobby. A right PIN (or a profile without one)
// returns a session token the game server checks before letting a socket play
// under that name. Wrong PINs are counted: 8 per 15 minutes per profile.
export async function POST(request, { params }) {
  try {
    const { id } = await params
    const { pin } = (await readJson(request)) || {}
    const locked = await pinLocked(id)
    if (locked) return locked
    const result = await store.verifyProfilePin(id, pin)
    if (result.ok) {
      return json({ ok: true, hadPin: !!result.hadPin, token: await store.createProfileSession(id) })
    }
    if (result.reason === 'not_found') {
      return json({ ok: false, error: 'Profile not found' }, 404)
    }
    await recordWrongPin(id)
    return json({ ok: false, error: 'Wrong PIN' }, 401)
  } catch (err) { return sendErr(err) }
}
