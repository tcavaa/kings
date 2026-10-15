import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// One finished game with its rounds, without photos — for a game's own page
// (/leaderboard/game/<id>), so it needn't download every game.
export async function GET(request, { params }) {
  try {
    const { id } = await params
    const game = await store.getGameWithoutAvatars(id)
    return game ? json(game) : json({ error: 'Game not found' }, 404)
  } catch (err) { return sendErr(err) }
}
