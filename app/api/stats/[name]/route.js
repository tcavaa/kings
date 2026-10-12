import store from '@/server/db/store'
import { json, parseMode, query, sendErr } from '@/lib/api/http'

// Lifetime counters for one player name, computed from every stored game.
export async function GET(request, { params }) {
  try {
    const { name } = await params
    const stats = await store.getLifetimeStats(name, parseMode(query(request, 'mode'), 'all'))
    return json(stats)
  } catch (err) { return sendErr(err) }
}
