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
        brand: '#220247',
        'brand-dark': '#15012E',
        'brand-light': '#E8E0F5',
        accent: '#F5E447',
        'accent-dark': '#D4C12E',
        'accent-light': '#FFF9D6',
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
