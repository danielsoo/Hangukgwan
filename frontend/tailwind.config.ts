import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: '#FAF7F2',
        ivory: '#F0EAE0',
        charcoal: '#1C1B18',
        stone: '#2E2E28',
        muted: '#7A7A6E',
        border: '#E0D8CC',
        primary: {
          DEFAULT: '#C0392B',
          dark: '#922B21',
          light: '#E74C3C',
        },
        gold: {
          DEFAULT: '#B08015',
          light: '#D4A017',
        },
      },
      fontFamily: {
        sans: ['var(--font-noto-sans)', 'Noto Sans KR', 'sans-serif'],
        serif: ['var(--font-noto-serif)', 'Noto Serif KR', 'Georgia', 'serif'],
      },
      animation: {
        'fade-up': 'fadeUp 0.8s ease-out both',
        'fade-in': 'fadeIn 1s ease-out both',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(32px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
