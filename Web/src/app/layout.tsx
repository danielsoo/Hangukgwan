import type { Metadata } from 'next'
import { Providers } from './providers'
import Header from '@/components/Header'
import Footer from '@/components/Footer'
import './globals.css'

export const metadata: Metadata = {
  title: '韓國館 Hangukgwan · 竹北韓式料理',
  description: '正宗韓式家常料理，以細緻的款待端上每一桌 | 新竹縣竹北市 | Authentic Korean Home Cooking in Zhubei, Hsinchu',
  keywords: ['한국관', 'Hangukgwan', '韓國館', '韓國料理', 'Korean Restaurant', 'Hsinchu', 'Zhubei', '新竹', '竹北'],
  openGraph: {
    title: '韓國館 Hangukgwan',
    description: '正宗韓式家常料理，以細緻的款待端上每一桌。',
    type: 'website',
  },
}

// Applies the saved theme before paint, so the page never flashes the
// wrong theme while React hydrates (ThemeContext re-applies it after).
const ANTI_FLASH_SCRIPT = `
try {
  var t = localStorage.getItem('hgw-theme');
  if (t === 'light') document.documentElement.setAttribute('data-theme', 'light');
} catch (e) {}
`

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-Hant">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script dangerouslySetInnerHTML={{ __html: ANTI_FLASH_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <Header />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  )
}
