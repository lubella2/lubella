/**
 * LuBella design tokens.
 *
 * The palette is sampled directly from the shop logo artwork, so the app and
 * the logo can never drift apart. See docs/01-BRAND.md.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          rose: '#D1809A',
          deep: '#B96482',
          blush: '#FBEDF3',
          soft: '#FDF6F9',
          charcoal: '#4A4A4A',
          ink: '#2E2A2C',
          muted: '#8A8489',
          line: '#EFE1E8',
        },
        state: {
          green: '#3F9D6D',
          amber: '#D99A2B',
          red: '#C8433F',
          slate: '#6B7280',
        },
      },
      fontFamily: {
        // Georgia italic echoes the logo's calligraphic wordmark without
        // shipping a webfont (previews block external font requests).
        display: ['Georgia', '"Times New Roman"', 'serif'],
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', '"Roboto Mono"', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(46,42,44,0.04), 0 4px 16px rgba(209,128,154,0.08)',
        lift: '0 4px 12px rgba(46,42,44,0.08), 0 12px 32px rgba(209,128,154,0.14)',
        inset: 'inset 0 1px 2px rgba(46,42,44,0.06)',
      },
      borderRadius: {
        xl2: '1.15rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.22s ease-out both',
        'slide-up': 'slide-up 0.25s cubic-bezier(0.32,0.72,0,1) both',
        shimmer: 'shimmer 1.4s infinite',
      },
    },
  },
  plugins: [],
};
