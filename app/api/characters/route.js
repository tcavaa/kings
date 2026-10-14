import store from '@/server/db/store'
import { json, query, sendErr } from '@/lib/api/http'

// Looks for everyone at a table in one request: ?ids=a,b,c → { [id]: look }.
export async function GET(request) {
  try {
    const ids = String(query(request, 'ids') || '').split(',').map((s) => s.trim()).filter(Boolean)
    return json(await store.getCharacters(ids))
  } catch (err) { return sendErr(err) }
}
