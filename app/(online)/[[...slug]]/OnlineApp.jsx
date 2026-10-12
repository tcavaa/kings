'use client'

import dynamic from 'next/dynamic'

// The King Online SPA, exactly as Vite served it: rendered in the browser
// only (it reads localStorage and window during render), no SSR.
const App = dynamic(() => import('../../../src/online/App'), { ssr: false })

export default function OnlineApp() {
  return <App />
}
