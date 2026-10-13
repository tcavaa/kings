import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// A profile's photo. Every link carries ?v=<photo hash>, so a given URL never
// changes and can be cached for good; a new photo gets a new URL.
export async function GET(request, { params }) {
  try {
    const { id } = await params
    const photo = await store.getProfileAvatar(id)
    if (!photo) return json({ error: 'No photo' }, 404)
    const v = new URL(request.url).searchParams.get('v')
    const cache = v === photo.version
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=60'
    return new Response(photo.buffer, {
      headers: { 'Content-Type': photo.mime, 'Cache-Control': cache, 'CDN-Cache-Control': cache },
    })
  } catch (err) { return sendErr(err) }
}
