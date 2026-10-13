import store from '@/server/db/store'
import { json, readJson, requireAdmin, sendErr } from '@/lib/api/http'

// Every season, newest first (both apps show them).
export async function GET() {
  try {
    return json(await store.listSeasons())
  } catch (err) { return sendErr(err) }
}

// /admin: { action: 'preview' } shows who would be crowned now;
// { action: 'end', name, theme } closes the season and opens the next one.
export async function POST(request) {
  try {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const { action, name, theme } = (await readJson(request)) || {}
    if (action === 'preview') return json(await store.previewSeasonEnd())
    if (action === 'end') return json(await store.endSeason({ name, theme }))
    return json({ error: 'Unknown action' }, 400)
  } catch (err) { return sendErr(err) }
}

// /admin: rename or re-theme the current season.
export async function PATCH(request) {
  try {
    const denied = await requireAdmin(request)
    if (denied) return denied
    const { name, theme } = (await readJson(request)) || {}
    await store.updateCurrentSeason({ name, theme })
    return json({ ok: true })
  } catch (err) { return sendErr(err) }
}
