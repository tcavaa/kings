import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// A player's King Online league games in the running season, against the
// season's 40-game cap — the lobby shows it as "played / 40". Nothing is
// blocked: past the cap a player keeps playing, the season stops counting.
export async function GET(_request, { params }) {
  try {
    const { name } = await params
    return json(await store.getSeasonQuota(name))
  } catch (err) { return sendErr(err) }
}
