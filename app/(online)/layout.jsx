// King Online's root layout — the old client/index.html. Its own <html>, so
// none of its CSS (Tailwind's preflight included) can ever reach the score
// app: moving between the two root layouts is a full page load.
import '../../src/online/styles/index.css'

export const metadata = {
  title: 'KING — The Card Club',
  manifest: '/manifest.json',
  icons: {
    icon: { url: '/king-mark.svg', type: 'image/svg+xml' },
    apple: '/art/app-icon.png',
  },
  appleWebApp: { statusBarStyle: 'black-translucent' },
  other: {
    'apple-mobile-web-app-capable': 'yes',
    'mobile-web-app-capable': 'yes',
  },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  // viewport-fit=cover lets the page paint into the safe-area regions
  // (notch, home indicator) instead of being clipped at the visible bar
  // edges. Combined with env(safe-area-inset-*) padding in CSS, this keeps
  // the bottom HUD pills above the URL bar on iOS Safari.
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
  themeColor: '#0c1716',
}

export default function OnlineLayout({ children }) {
  return (
    <html lang="ka">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+Georgian:wght@400;500;600;700&display=swap"
        />
        <style>{'html, body { margin: 0; padding: 0; background: #0c1716; }'}</style>
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
