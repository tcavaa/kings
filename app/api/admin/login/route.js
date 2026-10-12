import { checkAdminPass, json, readJson, sendErr } from '@/lib/api/http'

// Passcode check for the /admin login screen. Nothing is handed back but a
// yes/no; the client re-sends the passcode as a header on every later call.
export async function POST(request) {
  try {
    const body = (await readJson(request)) || {}
    if (!checkAdminPass(body.passcode)) {
      return json({ ok: false, error: 'Wrong passcode' }, 401)
    }
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
