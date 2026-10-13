import { AlertTriangle, WifiOff } from 'lucide-react'
import { useGame } from '../../context/GameContext'

/**
 * Top-of-screen banner used for two related states:
 *  • another seat is mid-reconnect       → "<name> disconnected …"
 *  • we ourselves are offline             → "Reconnecting …" (priority)
 *
 * The "self" variant takes priority because if our own socket is down we
 * can't trust any of the other state in the room anyway.
 */
export default function DisconnectBanner() {
  const { disconnectedPlayer, reconnecting } = useGame()

  if (reconnecting) {
    return (
      <div className="disconnect-banner absolute top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl text-xs font-medium pointer-events-auto inline-flex items-center gap-2">
        <WifiOff size={14} />
        <span>კავშირი აღდგება…</span>
      </div>
    )
  }

  if (!disconnectedPlayer) return null
  return (
    <div className="disconnect-banner absolute top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl text-xs font-medium pointer-events-auto inline-flex items-center gap-2">
      <AlertTriangle size={14} />
      <span>{disconnectedPlayer} გაითიშა — ველოდებით მის დაბრუნებას… თუ არ დაბრუნდება, მენიუდან „დანებებით" თამაშის დასრულება შეგიძლიათ.</span>
    </div>
  )
}
