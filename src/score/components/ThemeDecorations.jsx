import { useEffect, useMemo, useRef } from 'react'

/**
 * Full-viewport ambient scenery per season theme. Everything is fixed,
 * pointer-events: none and sits either BEHIND the content (`.theme-scene`,
 * z-index 0 — sky, sea, mountains) or ABOVE it (`.snow-layer`, z-index 940 —
 * falling snow), so it never interferes with the app.
 *
 *  - summer:    sky + sun + animated sea; the sun slides down and sinks
 *               into the sea as you scroll (driven by the --scroll-p var).
 *  - mountain:  layered ridges with scroll parallax, drifting fog banks
 *               and soaring birds.
 *  - christmas: falling snow above the UI (cards get CSS snow caps too).
 *  - casual:    nothing — clean table.
 */
export default function ThemeDecorations({ themeId }) {
  const sceneRef = useRef(null)

  // Randomised snowflakes, regenerated only when the theme flips.
  const flakes = useMemo(() => {
    if (themeId !== 'christmas') return []
    return Array.from({ length: 44 }, (_, i) => ({
      id: i,
      left: Math.random() * 100,
      size: 3 + Math.random() * 5,
      duration: 8 + Math.random() * 10,
      delay: -Math.random() * 18,
      drift: Math.round((Math.random() - 0.5) * 90),
      opacity: 0.45 + Math.random() * 0.55,
      blur: Math.random() < 0.3 ? 1.5 : 0,
    }))
  }, [themeId])

  // Scroll progress (0 at top → 1 at bottom) exposed as --scroll-p on the
  // scene element; CSS turns it into the sun's descent / ridge parallax.
  useEffect(() => {
    if (themeId !== 'summer' && themeId !== 'mountain') return undefined
    let raf = 0
    const update = () => {
      raf = 0
      const doc = document.documentElement
      const max = Math.max(1, doc.scrollHeight - window.innerHeight)
      const p = Math.min(1, Math.max(0, window.scrollY / max))
      sceneRef.current?.style.setProperty('--scroll-p', String(p))
    }
    const schedule = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule, { passive: true })
    return () => {
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [themeId])

  if (themeId === 'summer') {
    return (
      <div className="theme-scene scene-summer" ref={sceneRef} aria-hidden>
        <div className="summer-sky" />
        <div className="summer-sun" />
        <div className="summer-sea">
          <div className="summer-wave summer-wave-1" />
          <div className="summer-wave summer-wave-2" />
          <div className="summer-sea-shine" />
        </div>
      </div>
    )
  }

  if (themeId === 'mountain') {
    return (
      <div className="theme-scene scene-mountain" ref={sceneRef} aria-hidden>
        <div className="mountain-sky" />
        <div className="mountain-bird mountain-bird-1" />
        <div className="mountain-bird mountain-bird-2" />
        <div className="mountain-ridge mountain-ridge-far" />
        <div className="mountain-fog mountain-fog-1" />
        <div className="mountain-ridge mountain-ridge-mid" />
        <div className="mountain-fog mountain-fog-2" />
        <div className="mountain-ridge mountain-ridge-near" />
      </div>
    )
  }

  if (themeId === 'christmas') {
    return (
      <div className="snow-layer" aria-hidden>
        {flakes.map(f => (
          <span
            key={f.id}
            className="snowflake"
            style={{
              left: `${f.left}%`,
              width: f.size,
              height: f.size,
              opacity: f.opacity,
              filter: f.blur ? `blur(${f.blur}px)` : undefined,
              animationDuration: `${f.duration}s`,
              animationDelay: `${f.delay}s`,
              '--drift': `${f.drift}px`,
            }}
          />
        ))}
      </div>
    )
  }

  return null
}
