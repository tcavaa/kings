import store from '@/server/db/store'
import { json, jsonArray, parseMode, query, readJson, sendErr } from '@/lib/api/http'

// King Online's own leaderboard: every mode by default (?mode=championship|
// public|all), ?limit=N (max 200) or ?limit=all.
export async function GET(request) {
  try {
    const games = await store.listGames(query(request, 'limit'), parseMode(query(request, 'mode'), 'all'))
    return jsonArray(games)
  } catch (err) { return sendErr(err) }
}

// The clients' backup save at game over (the server has already saved the
// same id — whichever lands first wins).
export async function POST(request) {
  try {
    const saved = await store.saveFinishedGame((await readJson(request)) || {})
    return json(saved, 201)
  } catch (err) { return sendErr(err) }
}
