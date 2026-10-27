import { Inter, Noto_Sans_Georgian } from 'next/font/google'
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' })
const georgian = Noto_Sans_Georgian({ subsets: ['georgian'], display: 'swap', variable: '--font-noto-georgian' })

// The score app's root layout — the old KingScoreApp index.html. Separate
// <html> from King Online, so the two stylesheets never meet.
export const metadata = {
  title: 'King Score — ჩაწერა',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: { url: '/12427687.png', type: 'image/png' },
    apple: '/12427687.png',
  },
  appleWebApp: { statusBarStyle: 'black-translucent' },
  other: { 'apple-mobile-web-app-capable': 'yes' },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#171919',
}

export default function ScoreLayout({ children }) {
  return (
    <html lang="ka" className={`${inter.variable} ${georgian.variable}`}>
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
