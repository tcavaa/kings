import { json } from '@/lib/api/http'

// Unknown API paths are a 404 — without this the King Online catch-all page
// would answer them with the app's HTML.
function notFound(request) {
  const { pathname } = new URL(request.url)
  return json({ error: `Cannot ${request.method} ${pathname}` }, 404)
}

export { notFound as GET, notFound as POST, notFound as PUT, notFound as DELETE, notFound as PATCH }
