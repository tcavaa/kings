import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

export async function GET(_request, { params }) {
  try {
    const { id } = await params
    const g = await store.getGame(id)
    if (!g) return json({ error: 'Game not found' }, 404)
    return json(g)
  } catch (err) { return sendErr(err) }
}
