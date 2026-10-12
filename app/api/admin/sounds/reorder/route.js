import store from '@/server/db/store'
import { UPLOAD_LIMIT, json, readJson, requireAdmin, sendErr } from '@/lib/api/http'

// Drag-and-drop ordering. Its own path rather than a verb on /:id, so it can
// never be shadowed by (or shadow) a clip whose slug happens to be "reorder".
export async function POST(request) {
  try {
    const body = await readJson(request, UPLOAD_LIMIT)
    const denied = requireAdmin(request)
    if (denied) return denied
    return json(await store.reorderSounds((body || {}).ids))
  } catch (err) { return sendErr(err) }
}
