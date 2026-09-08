import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithRouter } from '../test/test-utils'
import type { PromoterPublicInfo } from '../lib/types'

// ── Module mocks ───────────────────────────────────────────────────────────────
// `createFileRoute` runs at import time and needs a generated route tree, so it
// is stubbed out. The rest of the router stays real: ReferralLanding renders a
// <Link> and `renderWithRouter` mounts a real memory router around it.
vi.mock('@tanstack/react-router', async (importOriginal) => {
  const original = await importOriginal<typeof import('@tanstack/react-router')>()
  return {
    ...original,
    createFileRoute: () => () => ({}),
    redirect: vi.fn(),
  }
})
vi.mock('../lib/queries', () => ({ usePromoterByCode: vi.fn() }))
vi.mock('../lib/api', () => ({ api: { get: vi.fn() }, TOKEN_KEY: 'dashgo.token' }))

import { usePromoterByCode } from '../lib/queries'
import { ReferralLanding } from './r.$code'

const mockUsePromoter = vi.mocked(usePromoterByCode)

function setPromoter(
  state: Partial<{
    data: PromoterPublicInfo | undefined
    isPending: boolean
    isError: boolean
  }> = {},
) {
  mockUsePromoter.mockReturnValue({
    data: { fullName: 'María Luna' },
    isPending: false,
    isError: false,
    ...state,
  } as unknown as ReturnType<typeof usePromoterByCode>)
}

async function renderLanding(code = 'ABCD2345') {
  renderWithRouter(() => <ReferralLanding code={code} />)
  await screen.findByText('Invitación')
}

describe('ReferralLanding — the app is the primary path', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setPromoter()
  })

  it('keeps the promoter greeting for a valid code', async () => {
    await renderLanding()
    expect(screen.getByText('María Luna')).toBeInTheDocument()
  })

  it('makes "Descargar la app" the primary CTA, pointing at the smart /app link', async () => {
    await renderLanding()
    const cta = screen.getByRole('link', { name: /Descargar la app/i })
    // /app is a Vercel user-agent redirect, not a router route → plain anchor.
    expect(cta).toHaveAttribute('href', '/app')
    // and it tells the user what to do once the app opens
    expect(
      screen.getByText(/Tengo un código de promotor/i),
    ).toBeInTheDocument()
  })

  it('copies the code to the clipboard and confirms it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    await renderLanding('abcd2345')

    fireEvent.click(screen.getByRole('button', { name: /Copiar código/i }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ABCD2345'))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Copiado/i })).toBeInTheDocument(),
    )
  })

  it('does not blow up when the clipboard API is missing', async () => {
    Object.assign(navigator, { clipboard: undefined })
    await renderLanding()
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: /Copiar código/i })),
    ).not.toThrow()
  })

  it('keeps the web as a secondary path, carrying the code to /login', async () => {
    await renderLanding('abcd2345')
    const web = screen.getByRole('link', { name: /Seguir en la web/i })
    expect(web).toHaveAttribute('href', expect.stringContaining('/login'))
    expect(web).toHaveAttribute('href', expect.stringContaining('ABCD2345'))
  })

  it('still shows the invalid-code state untouched', async () => {
    setPromoter({ data: undefined, isError: true })
    await renderLanding()
    expect(screen.getByText(/no válido/i)).toBeInTheDocument()
    expect(
      screen.queryByRole('link', { name: /Descargar la app/i }),
    ).not.toBeInTheDocument()
  })
})
