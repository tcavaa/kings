import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// King Score's seasons (newest first), for King Online's leaderboard.
export async function GET() {
  try {
    return json(await store.listSeasons())
  } catch (err) { return sendErr(err) }
}
