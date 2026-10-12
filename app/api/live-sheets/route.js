import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// ჩაწერა games being played at a table right now.
export async function GET() {
  try {
    return json(await store.listLiveSheets())
  } catch (err) { return sendErr(err) }
}
