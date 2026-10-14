import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// The uploaded head model. Links carry ?v=<hash>, so a matching URL never
// changes and is cached for good; a new upload gets a new URL.
export async function GET(request, { params }) {
  try {
    const { id } = await params
    const head = await store.getCharacterHead(id)
    if (!head) return json({ error: 'No head model' }, 404)
    const v = new URL(request.url).searchParams.get('v')
    const cache = v === head.version
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=60'
    return new Response(head.buffer, {
      headers: {
        'Content-Type': 'model/gltf-binary',
        'Cache-Control': cache,
        'CDN-Cache-Control': cache,
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) { return sendErr(err) }
}
