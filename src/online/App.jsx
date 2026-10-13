import { useState, useEffect, lazy, Suspense } from 'react'
import { GameProvider, useGame, useToasts } from './context/GameContext'
import Lobby        from './components/Lobby'
import WaitingRoom  from './components/WaitingRoom'

// Heavy screens are code-split so the lobby doesn't pay for them up front:
// GameLayout drags in Phaser (~1.5 MB), GameOverScreen pulls canvas-confetti
// + recharts (via ScoreChart), Leaderboard pulls the recharts panels.
const loadGameLayout = () => import('./components/GameLayout')
const GameLayout     = lazy(loadGameLayout)
const GameOverScreen = lazy(() => import('./components/GameOverScreen'))
const Leaderboard    = lazy(() => import('./components/Leaderboard'))
// The /admin sound-management page. Lazy so ordinary players never download
// it, and mounted outside GameProvider — it has no business opening a socket.
const AdminApp       = lazy(() => import('./components/Admin/AdminApp'))

// The app has no router: the server's SPA fallback serves index.html for any
// path, so a single pathname check is all the routing /admin needs.
function isAdminPath() {
  if (typeof window === 'undefined') return false
  return /^\/admin\/?$/.test(window.location.pathname)
}

/** Parchment-toned full-screen fallback shown while a lazy chunk loads.
    Background matches the GameLayout wrapper and the Phaser boot color so
    the transition into the game never flashes a different shade. */
function ScreenLoader() {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-3"
         style={{ background: '#0b1615' }}>

      <span className="text-sm font-typewriter" style={{ color: '#c4cfbf' }}>
        თამაში იტვირთება…
      </span>
    </div>
  )
}

const TOAST_STYLES = {
  error:   { bg: 'rgba(111,31,26,0.96)',  border: 'rgba(255,226,190,0.45)', color: '#f5f2e9' },
  success: { bg: 'rgba(122,199,165,0.95)',  border: 'rgba(244,232,207,0.45)', color: '#10211d' },
  warning: { bg: '#262e22', border: '#a4ba7e', color: '#edf2e2' },
  info:    { bg: 'rgba(23,39,35,0.97)',border: 'rgba(213,185,130,0.45)',   color: '#eeeae1' },
}

function ToastContainer() {
  const { toasts } = useToasts()
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => {
        const s = TOAST_STYLES[toast.type] ?? TOAST_STYLES.info
        return (
          <div key={toast.id}
               className="toast-enter px-4 py-3 rounded-sm shadow-lg text-xs font-medium max-w-xs pointer-events-auto"
               style={{
                 background: s.bg,
                 border: `1px solid ${s.border}`,
                 color: s.color,
                 backdropFilter: 'blur(12px)',
                 boxShadow: '0 8px 30px #0003',
               }}>
            {toast.message}
          </div>
        )
      })}
    </div>
  )
}

function AppInner() {
  const { appPhase, publicSeat, tournament } = useGame()
  const [view, setView] = useState('main') // 'main' | 'leaderboard'
  // A quick-match seat or a tournament entry can turn into a game at any
  // moment, without a WaitingRoom to prefetch the table from: fetch the
  // (large) game chunk now so the deal doesn't wait on it.
  const tableAhead = publicSeat !== null || (!!tournament && tournament.status !== 'done')
  useEffect(() => {
    if (tableAhead) loadGameLayout().catch(() => { /* retried by lazy() */ })
  }, [tableAhead])
  // A table can start while the leaderboard is open (a quick-match seat
  // filling, a tournament draw or final) — show it.
  useEffect(() => {
    if (appPhase === 'game' || appPhase === 'waiting') setView('main')
  }, [appPhase])

  return (
    <div className="min-h-screen text-ink"
         style={{ background: '#091211', minHeight: '100dvh' }}>
      <ToastContainer />
      <Suspense fallback={<ScreenLoader />}>
        {view === 'leaderboard' ? (
          <Leaderboard onBack={() => setView('main')} />
        ) : (
          <>
            {appPhase === 'lobby'    && (
              <Lobby onOpenLeaderboard={() => setView('leaderboard')} />
            )}
            {appPhase === 'waiting'  && <WaitingRoom />}
            {appPhase === 'game'     && <GameLayout />}
            {appPhase === 'gameover' && <GameOverScreen onOpenLeaderboard={() => setView('leaderboard')} />}
          </>
        )}
      </Suspense>
    </div>
  )
}

export default function App() {
  // Checked once at module-render time — /admin is a full page load, never a
  // client-side transition, so there's nothing to re-evaluate.
  if (isAdminPath()) {
    return (
      <div className="min-h-screen text-ink" style={{ background: '#091211', minHeight: '100dvh' }}>
        <Suspense fallback={<ScreenLoader />}>
          <AdminApp />
        </Suspense>
      </div>
    )
  }

  return (
    <GameProvider>
      <AppInner />
    </GameProvider>
  )
}
