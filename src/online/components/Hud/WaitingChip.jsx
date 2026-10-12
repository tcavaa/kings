import { memo } from 'react'
/**
 * Tiny pill that hovers above the table when we're stuck waiting for another
 * player to do something (play a card, choose a game type, etc.).
 */
function WaitingChip({ label, name }) {
  return (
    // Positioned off the safe-area inset like the rest of the top-centre
    // stack (TopBar → clock → this → round quote). It used to be a flat
    // `top-20`, which drifted relative to everything else on notched phones
    // and now would collide with the elapsed-time clock.
    <div className="absolute left-1/2 -translate-x-1/2 z-15 pointer-events-none"
         style={{ top: 'calc(env(safe-area-inset-top, 0px) + 108px)' }}>
      <div className="western-pill px-5 py-2 text-xs font-typewriter">
        ველოდებით <span className="font-western font-bold text-amber">{name ?? '…'}</span>-ს {label}
      </div>
    </div>
  )
}

// Leaf HUD chrome: props are stable callbacks, so memo() shields it from
// GameLayout's unrelated re-renders (chat traffic, drawer toggles).
export default memo(WaitingChip)
