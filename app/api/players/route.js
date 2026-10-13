import store from '@/server/db/store'
import { json, readJson, requireAdmin, sendErr } from '@/lib/api/http'

// The one player list (King Online's profiles), names only — ჩაწერა's picker.
export async function GET() {
  try {
    return json(await store.listPlayers())
  } catch (err) { return sendErr(err) }
}

// /admin: add a player (a profile without a PIN).
export async function POST(request) {
  try {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const { name } = (await readJson(request)) || {}
    return json(await store.createPlayer(name), 201)
  } catch (err) { return sendErr(err) }
}
