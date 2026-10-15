'use client'

import { StrictMode } from 'react'
import dynamic from 'next/dynamic'

// The score app as Vite served it: browser-only (it reads localStorage
// during render), inside <StrictMode> like its old main.jsx. Until its code
// arrives the page shows a light shell instead of a blank screen (the
// stylesheet comes with the code, so the shell styles itself).
const App = dynamic(() => import('../../../../src/score/App'), {
  ssr: false,
  loading: () => (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui, sans-serif', color: '#6b7280' }}>
      <div style={{ textAlign: 'center' }}>
        <img src="/12427687.png" alt="" width={56} height={56} style={{ display: 'block', margin: '0 auto 12px' }} />
        იტვირთება…
      </div>
    </div>
  ),
})

export default function ScoreApp() {
  return (
    <StrictMode>
      <App />
    </StrictMode>
  )
}
