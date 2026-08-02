import type { Metadata } from 'next'
import { Providers } from './providers'
import './globals.css'

export const metadata: Metadata = {
  title: '한국관 — Hangukgwan',
  description: '대만 신죽에서 만나는 정통 한국 가정식 | Authentic Korean Dining in Hsinchu, Taiwan',
  keywords: ['한국관', 'Hangukgwan', '韓國館', '韓國料理', 'Korean Restaurant', 'Hsinchu', '新竹'],
  openGraph: {
    title: '한국관 — Hangukgwan',
    description: 'Authentic Korean Dining in Hsinchu, Taiwan',
    type: 'website',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="ko">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
