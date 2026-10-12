import store from '@/server/db/store'
import { json, parseMode, query, sendErr } from '@/lib/api/http'

// Per-player win/score table over King Online games, for the score app.
// Championship games only by default, like the old public API.
export async function GET(request) {
  try {
    return json(await store.getPublicLeaderboard(parseMode(query(request, 'mode'), 'championship')))
  } catch (err) { return sendErr(err) }
}
