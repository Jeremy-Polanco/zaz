import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    // Vitest owns the unit/component suite (src/**/*.test.*). Playwright owns
    // the browser e2e suite (e2e/**/*.spec.ts) — exclude it so vitest's default
    // glob doesn't try to run Playwright specs.
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // api.ts throws at import time if VITE_API_URL is missing. Components that
    // import it (e.g. CategoryCard, for categoryImageUrl) need a value present
    // so the module loads under test. Mirrors the prod shape: base ends in /api.
    env: { VITE_API_URL: 'http://localhost:3001/api' },
    globals: true,
    typecheck: {
      tsconfig: './tsconfig.test.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      exclude: [
        '**/*.test.{ts,tsx}',
        '**/test/**',
        'src/routeTree.gen.ts',
        'src/main.tsx',
        'src/index.css',
      ],
    },
  },
})
