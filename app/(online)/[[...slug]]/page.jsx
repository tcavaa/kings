import OnlineApp from './OnlineApp'

// Catch-all, like the old Express SPA fallback: every path that isn't the
// score app or an API route renders King Online. The app does its own
// "routing" (e.g. /admin) from window.location.
export default function Page() {
  return <OnlineApp />
}
