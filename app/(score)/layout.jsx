// The score app's root layout — the old KingScoreApp index.html. Separate
// <html> from King Online, so the two stylesheets never meet.
export const metadata = {
  title: 'King Score',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: { url: '/12427687.png', type: 'image/png' },
    apple: '/12427687.png',
  },
  appleWebApp: { statusBarStyle: 'black' },
  other: { 'apple-mobile-web-app-capable': 'yes' },
}

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#f4f4f6',
}

export default function ScoreLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <div id="root">{children}</div>
      </body>
    </html>
  )
}
