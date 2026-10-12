import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// Championship daily quota — the lobby greys out the championship options
// once a player has finished today's allowance.
export async function GET(_request, { params }) {
  try {
    const { name } = await params
    return json(await store.getChampionshipQuota(name))
  } catch (err) { return sendErr(err) }
}
