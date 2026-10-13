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

// /admin: { action: 'clear-pin' } removes a forgotten PIN.
export async function POST(request, { params }) {
  try {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const { id } = await params
    const { action } = (await readJson(request)) || {}
    if (action !== 'clear-pin') return json({ error: 'Unknown action' }, 400)
    if (!(await store.clearPlayerPin(id))) return json({ error: 'Player not found' }, 404)
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
