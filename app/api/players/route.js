import store from '@/server/db/store'
import { json, readJson, sendErr } from '@/lib/api/http'

// ჩაწერა's player list: the same profiles King Online uses, names only.
export async function GET() {
  try {
    return json(await store.listPlayers())
  } catch (err) { return sendErr(err) }
}

// Add a player from ჩაწერა (a profile without a PIN).
export async function POST(request) {
  try {
    const { name } = (await readJson(request)) || {}
    return json(await store.createPlayer(name), 201)
  } catch (err) { return sendErr(err) }
}
