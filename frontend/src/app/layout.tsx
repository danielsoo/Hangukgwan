import type { Metadata } from 'next'
import { Noto_Sans_KR, Noto_Serif_KR } from 'next/font/google'
import { Providers } from './providers'
import './globals.css'

const notoSans = Noto_Sans_KR({
  weight: ['300', '400', '500', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-noto-sans',
})

const notoSerif = Noto_Serif_KR({
  weight: ['400', '700'],
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-noto-serif',
})

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
    <html lang="ko" className={`${notoSans.variable} ${notoSerif.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
