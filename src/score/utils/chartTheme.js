import { useEffect, useState } from 'react'

// Follow the light/dark palette used by the score screen.
function readTheme() {
  const css = getComputedStyle(document.body)
  const v = name => css.getPropertyValue(name).trim()
  const text = v('--text')
  const muted = v('--muted')
  return {
    grid: v('--grid-stroke'),
    muted,
    text,
    tick: { fontSize: 11, fill: muted },
    // Recharts' tooltip label inherits no colour of its own: give it one, or
    // dark mode puts light text on the tooltip.
    tooltipStyle: { background: v('--tooltip-bg'), color: text, border: `1px solid ${v('--line-strong')}`, borderRadius: 8, fontSize: 13 },
  }
}

export function useChartTheme() {
  const [theme, setTheme] = useState(readTheme)
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(readTheme()))
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return theme
}
