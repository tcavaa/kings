import store from '@/server/db/store'
import { UPLOAD_LIMIT, json, readJson, requireAdmin, sendErr } from '@/lib/api/http'

export async function PUT(request, { params }) {
  try {
    const body = await readJson(request, UPLOAD_LIMIT)
    const denied = requireAdmin(request)
    if (denied) return denied
    const { id } = await params
    const saved = await store.updateSound(id, body || {})
    if (!saved) return json({ error: 'Sound not found' }, 404)
    return json(saved)
  } catch (err) { return sendErr(err) }
}

export async function DELETE(request, { params }) {
  try {
    await readJson(request, UPLOAD_LIMIT)
    const denied = requireAdmin(request)
    if (denied) return denied
    const { id } = await params
    const ok = await store.deleteSound(id)
    if (!ok) return json({ error: 'Sound not found' }, 404)
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
