/**
 * Shared shell for the in-game modal overlays: a dimmed wine-cellar backdrop
 * (`.western-backdrop`) with a parchment `.western-panel` centered inside.
 *
 * Layout knobs stay at the call site via className strings:
 *  - `className`      → the backdrop container (z-index, padding, items-start
 *                       vs items-center, overflow-y-auto, …)
 *  - `panelClassName` → the panel (max-w-*, p-*, text-center, my-auto, …)
 *  - `overlay`        → optional node rendered inside the backdrop but outside
 *                       the panel (e.g. RoundResult's rolling-jug animation)
 */
export default function ModalShell({ className = '', panelClassName = '', overlay = null, children }) {
  return (
    <div className={`absolute inset-0 flex justify-center western-backdrop ${className}`}>
      {overlay}
      <div className={`w-full k-modal-panel western-panel ${panelClassName}`}>
        {children}
      </div>
    </div>
  )
}
