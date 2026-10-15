import OnlineApp from './OnlineApp'

// Catch-all, like the old Express SPA fallback: every path that isn't the
// score app or an API route renders King Online. The app routes itself in
// the browser (shared/router.js): /leaderboard, /room/CODE, /admin, …
export default function Page() {
  return <OnlineApp />
}
