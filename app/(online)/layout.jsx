// King Online's root layout — the old client/index.html. Its own <html>, so
// none of its CSS (Tailwind's preflight included) can ever reach the score
// app: moving between the two root layouts is a full page load.
import { Inter, Noto_Sans_Georgian } from 'next/font/google'
import '../../src/online/styles/index.css'

// Self-hosted by next/font: no render-blocking request to Google at runtime.
// Both are variable fonts (no `weight`), which covers every weight the CSS
// uses, 200–900 with the in-between ones (350, 450, 650…). next/font
// declares its own families (each with a size-matched local fallback) and
// publishes the family list in these CSS variables: the CSS uses
// var(--font-…), and the Phaser table reads the same variables
// (src/online/game/lib/fonts.js) and waits for the fonts before drawing text.
const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
})
const notoGeorgian = Noto_Sans_Georgian({
  // Every subset is self-hosted (unicode-range picks per glyph); `subsets`
  // only chooses what to preload: the Georgian text this app is mostly in.
  subsets: ['georgian'],
  display: 'swap',
  variable: '--font-noto-georgian',
})

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
    <html lang="ka" className={`${inter.variable} ${notoGeorgian.variable}`}>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
