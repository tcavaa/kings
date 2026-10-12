import store from '@/server/db/store'
import { json, readJson, sendErr } from '@/lib/api/http'

// PIN verification — used by the lobby when the user picks a profile to play
// with. 200 / { ok: true } on success, 401 on a bad PIN, 404 if the profile
// doesn't exist. Not rate-limited: a 4-digit PIN in a shared lobby is a
// "stop your roommate" guard, not a security boundary.
export async function POST(request, { params }) {
  try {
    const { id } = await params
    const { pin } = (await readJson(request)) || {}
    const result = await store.verifyProfilePin(id, pin)
    if (result.ok) return json({ ok: true, hadPin: !!result.hadPin })
    if (result.reason === 'not_found') {
      return json({ ok: false, error: 'Profile not found' }, 404)
    }
    return json({ ok: false, error: 'Wrong PIN' }, 401)
  } catch (err) { return sendErr(err) }
}
