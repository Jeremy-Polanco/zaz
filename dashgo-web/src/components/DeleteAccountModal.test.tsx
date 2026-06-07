import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '../test/test-utils'
import { DeleteAccountModal } from './DeleteAccountModal'

describe('DeleteAccountModal', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing when closed', () => {
    const { container } = renderWithProviders(
      <DeleteAccountModal open={false} onClose={vi.fn()} onConfirm={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables the delete button until "BORRAR" is typed, then enables it', () => {
    renderWithProviders(
      <DeleteAccountModal open onClose={vi.fn()} onConfirm={vi.fn()} />,
    )
    const deleteBtn = screen.getByRole('button', { name: /Eliminar →/i })
    expect(deleteBtn).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/para confirmar/i), {
      target: { value: 'borrar' }, // case-insensitive
    })
    expect(deleteBtn).toBeEnabled()
  })

  it('calls onConfirm only after confirmation text matches', () => {
    const onConfirm = vi.fn()
    renderWithProviders(
      <DeleteAccountModal open onClose={vi.fn()} onConfirm={onConfirm} />,
    )
    fireEvent.change(screen.getByLabelText(/para confirmar/i), {
      target: { value: 'BORRAR' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Eliminar →/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when Cancelar is pressed', () => {
    const onClose = vi.fn()
    renderWithProviders(
      <DeleteAccountModal open onClose={onClose} onConfirm={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('shows an error message and a busy state while pending', () => {
    renderWithProviders(
      <DeleteAccountModal
        open
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        isPending
        errorMessage="No pudimos eliminar tu cuenta"
      />,
    )
    expect(screen.getByText('No pudimos eliminar tu cuenta')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Eliminando…/i })).toBeDisabled()
  })
})
