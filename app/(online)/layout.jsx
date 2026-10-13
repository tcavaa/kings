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
  // The ink of the club rail and the page canvas (:root in base.css); keep it
  // and public/manifest.json in step with them.
  themeColor: '#171919',
}

export default function OnlineLayout({ children }) {
  return (
    <html lang="ka">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Variable fonts over the whole 200–800 range the CSS uses (350, 450,
            650… included). Not next/font: the Phaser scenes draw canvas text
            by the plain family names, which next/font would hash. */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@200..800&family=Noto+Sans+Georgian:wght@200..800&display=swap"
        />
      </head>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
