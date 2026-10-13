import store from '@/server/db/store'
import { json, sendErr } from '@/lib/api/http'

// The bytes of an uploaded clip. Built-ins are static files in /public/sounds
// and never reach this route.
export async function GET(request, { params }) {
  try {
    const { id } = await params
    const version = await store.getSoundVersion(id)
    if (!version) return json({ error: 'Sound not found' }, 404)
    // The catalogue links to `?v=<version>`, and only that URL is cached for
    // good. Any other `v` (an old one, or a made-up one that would dodge the
    // CDN) is sent to the current URL instead of re-reading the clip.
    if (new URL(request.url).searchParams.get('v') !== version) {
      return new Response(null, {
        status: 307,
        headers: {
          Location: `/api/sounds/${encodeURIComponent(id)}/audio?v=${version}`,
          'Cache-Control': 'public, max-age=60',
        },
      })
    }
    const clip = await store.getSoundAudio(id)
    if (!clip) return json({ error: 'Sound not found' }, 404)
    return new Response(clip.buffer, {
      headers: {
        'Content-Type': clip.mime,
        'Content-Length': String(clip.buffer.length),
        // The `?v=` in the catalogue URL changes whenever the row is updated,
        // so the bytes behind any given URL really are immutable.
        'Cache-Control': 'public, max-age=31536000, immutable',
        // Same promise for Vercel's CDN, so a clip is read from the database
        // once rather than once per player.
        'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (err) { return sendErr(err) }
}
