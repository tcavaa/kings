import store from '@/server/db/store'
import { json, readJson, sendErr } from '@/lib/api/http'

// Save a game ჩაწერა just finished: { players: [{ id }], rounds, durationSeconds }.
export async function POST(request) {
  try {
    return json(await store.saveScoreSheetGame((await readJson(request)) || {}), 201)
  } catch (err) { return sendErr(err) }
}
