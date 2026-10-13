import store from '@/server/db/store'
import { json, readJson, requireAdmin, sendErr } from '@/lib/api/http'

// /admin: remove a player. Their games stay, under their name.
export async function DELETE(request, { params }) {
  try {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const { id } = await params
    if (!(await store.deletePlayer(id))) return json({ error: 'Player not found' }, 404)
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}

// /admin: { action: 'clear-pin' } removes a forgotten PIN;
// { action: 'set-pin', pin } gives a player a 4-digit PIN.
export async function POST(request, { params }) {
  try {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const { id } = await params
    const { action, pin } = (await readJson(request)) || {}
    let found
    if (action === 'clear-pin') found = await store.clearPlayerPin(id)
    else if (action === 'set-pin') found = await store.setPlayerPin(id, pin)
    else return json({ error: 'Unknown action' }, 400)
    if (!found) return json({ error: 'Player not found' }, 404)
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
