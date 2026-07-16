import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Parity test — Privacy Policy static HTML vs React component.
 *
 * WHY: /privacidad has two renders that must stay in lockstep:
 *   1. public/privacidad.html — static page served by Vercel rewrite, what
 *      App Review WebViews / curl / link previewers see on cold load.
 *   2. src/routes/privacidad.tsx — TanStack Router client component, what
 *      logged-in users see when they navigate via <Link to="/privacidad">.
 *
 * If the legal text diverges between the two, we ship inconsistent policy to
 * different audiences — which is exactly the App Store Guideline 5.1.1 trap.
 *
 * This test enforces that both versions agree on the load-bearing legal facts:
 * legal entity, contact email, physical address, and all 11 section titles.
 */

const REPO_ROOT = resolve(__dirname, '../..')

const staticHtml = readFileSync(
  resolve(REPO_ROOT, 'public/privacidad.html'),
  'utf-8',
)
const reactSource = readFileSync(
  resolve(REPO_ROOT, 'src/routes/privacidad.tsx'),
  'utf-8',
)

const LEGAL_FACTS = {
  legalName: 'UrbanDash LLC',
  contactEmail: 'urban@dashgo.dev',
  address: '45 Cypress Ave, Bogota, NJ 07603',
  lastUpdated: '1 de junio de 2026',
}

const SECTION_TITLES = [
  '1. Quiénes somos',
  '2. Qué datos recolectamos',
  '3. Cómo usamos tus datos',
  '4. Con quién compartimos tus datos',
  '5. Cuánto tiempo guardamos tus datos',
  '6. Tus derechos',
  '7. Niños menores de 13 años',
  '8. Seguridad',
  '9. Transferencias internacionales',
  '10. Cambios a esta política',
  '11. Contacto',
]

describe('privacy policy parity (static HTML vs React component)', () => {
  describe('static HTML at public/privacidad.html', () => {
    it('is a complete, self-contained HTML document (not a SPA shell)', () => {
      // App Review / link previewers must see real content, not <div id="root"></div>.
      expect(staticHtml).toMatch(/<!doctype html>/i)
      expect(staticHtml).toContain('<html lang="es"')
      expect(staticHtml).toContain('<title>')
      // SPA shell smell: empty mount node with no surrounding policy text.
      expect(staticHtml).not.toMatch(/<div id="root"><\/div>\s*<script/i)
    })

    it('exposes SEO and Open Graph metadata for crawlers', () => {
      // <meta> tags may be split across lines; match attribute presence loosely.
      expect(staticHtml).toMatch(/<meta\s+name="description"/i)
      expect(staticHtml).toMatch(/<meta\s+property="og:title"/i)
      expect(staticHtml).toMatch(/<meta\s+property="og:description"/i)
    })

    it.each(Object.entries(LEGAL_FACTS))(
      'includes load-bearing legal fact: %s',
      (_label, value) => {
        expect(staticHtml).toContain(value)
      },
    )

    it.each(SECTION_TITLES)('includes section title: %s', (title) => {
      expect(staticHtml).toContain(title)
    })

    it('links back to the home page', () => {
      expect(staticHtml).toMatch(/href="\/"/)
    })
  })

  describe('React component at src/routes/privacidad.tsx', () => {
    it.each(Object.entries(LEGAL_FACTS))(
      'includes load-bearing legal fact: %s',
      (_label, value) => {
        expect(reactSource).toContain(value)
      },
    )

    it.each(SECTION_TITLES)('declares section title: %s', (title) => {
      // React component wraps each section in <Section title="N. ...">.
      expect(reactSource).toContain(`title="${title}"`)
    })
  })

  describe('parity between the two', () => {
    it.each(Object.entries(LEGAL_FACTS))(
      'static HTML and React component agree on: %s',
      (_label, value) => {
        const inStatic = staticHtml.includes(value)
        const inReact = reactSource.includes(value)
        expect(
          inStatic && inReact,
          `Expected "${value}" in BOTH public/privacidad.html AND src/routes/privacidad.tsx ` +
            `(static=${inStatic}, react=${inReact}). ` +
            `If you updated one, update the other.`,
        ).toBe(true)
      },
    )

    it.each(SECTION_TITLES)(
      'static HTML and React component both render section: %s',
      (title) => {
        const inStatic = staticHtml.includes(title)
        const inReact = reactSource.includes(`title="${title}"`)
        expect(
          inStatic && inReact,
          `Expected section "${title}" in BOTH static and React. ` +
            `(static=${inStatic}, react=${inReact}). ` +
            `If you added/removed a section, update both files.`,
        ).toBe(true)
      },
    )
  })
})
