import store from '@/server/db/store'
import { json, jsonArray, parseMode, parseType, query, readJson, sendErr } from '@/lib/api/http'

// Every finished game, for both apps' leaderboards: King Online's and the
// ones recorded in ჩაწერა (?type=online|live|all, default all), every mode
// by default (?mode=championship|public|all), ?limit=N (max 200) or
// ?limit=all. ?avatars=0 leaves the players' photos out.
export async function GET(request) {
  try {
    const limit = query(request, 'limit')
    const mode = parseMode(query(request, 'mode'), 'all')
    const type = parseType(query(request, 'type'), 'all')
    const games = query(request, 'avatars') === '0'
      ? await store.listGamesWithoutAvatars(limit, mode, type)
      : await store.listGames(limit, mode, type)
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
