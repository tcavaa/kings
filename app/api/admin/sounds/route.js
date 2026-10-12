import store from '@/server/db/store'
import { UPLOAD_LIMIT, json, readJson, requireAdmin, sendErr } from '@/lib/api/http'

export async function GET(request) {
  try {
    const denied = requireAdmin(request)
    if (denied) return denied
    return json(await store.listSounds())
  } catch (err) { return sendErr(err) }
}

export async function POST(request) {
  try {
    const body = await readJson(request, UPLOAD_LIMIT)
    const denied = requireAdmin(request)
    if (denied) return denied
    return json(await store.createSound(body || {}), 201)
  } catch (err) { return sendErr(err) }
}
