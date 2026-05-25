/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        paper: '#FAFAFC',
        'paper-deep': '#F0F0F5',
        'paper-elev': '#FFFFFF',
        ink: '#1A1530',
        'ink-soft': '#4A4566',
        'ink-muted': '#6B6488',
        'ink-faint': 'rgba(26, 21, 48, 0.15)',
        'ink-hair': 'rgba(26, 21, 48, 0.10)',
        brand: '#000000',
        'brand-dark': '#0A0A0A',
        'brand-light': '#FFF5E6',
        accent: '#FF8000',
        'accent-dark': '#CC6600',
        'accent-light': '#FFE0BF',
        ok: '#2f7d5b',
        warn: '#7d5500',
        bad: '#a83232',
      },
      fontFamily: {
        sans: ['InterTight_400Regular'],
        'sans-medium': ['InterTight_500Medium'],
        'sans-semibold': ['InterTight_600SemiBold'],
        'sans-bold': ['InterTight_700Bold'],
        'sans-italic': ['InterTight_500Medium_Italic'],
      },
      letterSpacing: {
        eyebrow: '0.18em',
        label: '0.1em',
      },
      borderRadius: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
