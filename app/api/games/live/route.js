import store from '@/server/db/store'
import { json, readJson, sendErr } from '@/lib/api/http'

// Save a game ჩაწერა just finished: { sheetId, players: [{ id }], rounds,
// durationSeconds }. Saving the same sheetId again returns the stored game.
export async function POST(request) {
  try {
    return json(await store.saveScoreSheetGame((await readJson(request)) || {}), 201)
  } catch (err) { return sendErr(err) }
}
