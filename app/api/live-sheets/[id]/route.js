import store from '@/server/db/store'
import { json, readJson, sendErr } from '@/lib/api/http'

// Only the device keeping a sheet may change it: every write carries the
// random key that device made up for the sheet (X-Sheet-Key). The first write
// claims the sheet; the key itself is never stored or listed.
const sheetKey = (request) => request.headers.get('x-sheet-key') || ''

// The device keeping a sheet publishes it as rounds are entered…
export async function PUT(request, { params }) {
  try {
    const { id } = await params
    await store.saveLiveSheet(id, await readJson(request), sheetKey(request))
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}

// …and takes it down once the game is saved or reset.
export async function DELETE(request, { params }) {
  try {
    const { id } = await params
    await store.deleteLiveSheet(id, sheetKey(request))
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
