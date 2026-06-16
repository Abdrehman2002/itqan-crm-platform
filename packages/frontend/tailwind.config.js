/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ── Vivid Solutions & Services brand palette ─────────────────────
        // Primary: Cyan blue  #29ABE2
        // Secondary: Forest green  #4D8B3C
        // Accent: Gold yellow  #F5C518
        brand: {
          50:  '#e8f7fd',
          100: '#c5ecf9',
          200: '#8fd8f3',
          300: '#4dbfea',
          400: '#29ABE2',   // ← brand primary (cyan)
          500: '#1a94c9',
          600: '#1478a8',
          700: '#0f5c85',
          800: '#0a4162',
          900: '#062840',
          950: '#031520',
        },
        vivid: {
          // Green
          green: {
            50:  '#eef6ea',
            100: '#d4e9cb',
            200: '#a9d498',
            300: '#7abf64',
            400: '#5ba340',
            500: '#4D8B3C',   // ← brand green
            600: '#3d7030',
            700: '#2e5524',
            800: '#1f3a18',
            900: '#10200d',
          },
          // Yellow / Gold
          yellow: {
            50:  '#fffbe8',
            100: '#fff4c0',
            200: '#ffe87a',
            300: '#ffd93d',
            400: '#F5C518',   // ← brand yellow/gold
            500: '#d4a914',
            600: '#a88210',
            700: '#7c600b',
            800: '#503e07',
            900: '#292003',
          },
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.15s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
};
