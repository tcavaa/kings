import store from '@/server/db/store'
import { json, readJson, sendErr } from '@/lib/api/http'

// The device keeping a sheet publishes it as rounds are entered…
export async function PUT(request, { params }) {
  try {
    const { id } = await params
    await store.saveLiveSheet(id, await readJson(request))
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}

// …and takes it down once the game is saved or reset.
export async function DELETE(_request, { params }) {
  try {
    const { id } = await params
    await store.deleteLiveSheet(id)
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
