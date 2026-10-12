/**
 * Leather pill button — shared HUD building block.
 * The base look comes from the `.western-hud-pill` class in `styles/index.css`;
 * callers can override colours for accent variants (chosen-game-type pill,
 * trump pill, etc.) via the `style` prop.
 */
export function Pill({ children, onClick, className = '', style, title, ...rest }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`western-hud-pill ${className}`}
      style={style}
      {...rest}
    >
      {children}
    </button>
  )
}
