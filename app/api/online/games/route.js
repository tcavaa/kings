import store from '@/server/db/store'
import { jsonArray, parseMode, query, sendErr } from '@/lib/api/http'

// King Online games for the score app (history tab, seasons, analytics) —
// what it used to fetch from King Online's public API, now read straight
// from the shared database. Same contract: CHAMPIONSHIP games only unless
// ?mode=public|all, ?limit=N (max 200), and players' avatars stripped unless
// ?include=avatar (the payload shrinks ~100× without them).
export async function GET(request) {
  try {
    const limit = query(request, 'limit')
    const mode = parseMode(query(request, 'mode'), 'championship')
    if (String(query(request, 'include') || '').includes('avatar')) {
      return jsonArray(await store.listGames(limit, mode, 'online'))
    }
    const games = await store.listGamesWithoutAvatars(limit, mode, 'online')
    return jsonArray(games.map((game) => ({
      ...game,
      players: (game.players || []).map(({ avatar, ...rest }) => rest),
    })))
  } catch (err) { return sendErr(err) }
}
