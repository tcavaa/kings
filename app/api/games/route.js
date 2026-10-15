import store from '@/server/db/store'
import { jsonArray, parseMode, parseType, query, sendErr } from '@/lib/api/http'

// Every finished game, for both apps' leaderboards: King Online's and the
// ones recorded in ჩაწერა (?type=online|live|all, default all), every mode
// by default (?mode=championship|public|all), ?limit=N (max 200) or
// ?limit=all. ?avatars=0 leaves the players' photos out, ?rounds=0 the
// round-by-round details (tables and form need only the results). Only the game
// server writes games (when a game ends), so there is no POST.
export async function GET(request) {
  try {
    const limit = query(request, 'limit')
    const mode = parseMode(query(request, 'mode'), 'all')
    const type = parseType(query(request, 'type'), 'all')
    const games = query(request, 'avatars') === '0'
      ? await store.listGamesWithoutAvatars(limit, mode, type)
      : await store.listGames(limit, mode, type)
    if (query(request, 'rounds') === '0') {
      return jsonArray(games.map(({ roundDetails, ...game }) => game))
    }
    return jsonArray(games)
  } catch (err) { return sendErr(err) }
}
