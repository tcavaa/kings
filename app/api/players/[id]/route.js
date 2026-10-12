import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// Remove a player added in ჩაწერა. Their games stay; players with a King
// Online PIN can only be removed there.
export async function DELETE(_request, { params }) {
  try {
    const { id } = await params
    if (!(await store.deletePlayer(id))) return json({ error: 'Player not found' }, 404)
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
