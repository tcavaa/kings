import { checkAdmin, json, readJson, sendErr } from '@/lib/api/http'

// Passcode check for the /admin login screen. Nothing is handed back but a
// yes/no; the client re-sends the passcode as a header on every later call.
export async function POST(request) {
  try {
    const body = (await readJson(request)) || {}
    const denied = await checkAdmin(request, body.passcode)
    if (denied) return denied
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
