'use client'

import { StrictMode } from 'react'
import dynamic from 'next/dynamic'

// The score app as Vite served it: browser-only (it reads localStorage
// during render), inside <StrictMode> like its old main.jsx.
const App = dynamic(() => import('../../../src/score/App'), { ssr: false })

export default function ScoreApp() {
  return (
    <StrictMode>
      <App />
    </StrictMode>
  )
}
