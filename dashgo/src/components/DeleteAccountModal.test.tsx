/**
 * DeleteAccountModal tests
 *
 * Scenarios:
 *   1. Confirm button is disabled until the user types the confirmation word
 *   2. Confirm button is enabled when "BORRAR" is typed (case-insensitive)
 *   3. Tapping confirm calls onConfirm
 *   4. onConfirm is NOT called when the confirmation word is missing
 *   5. While `isPending`, the confirm button reflects loading state
 */
import React from 'react'
import { fireEvent, render } from '@testing-library/react-native'
import { DeleteAccountModal } from './DeleteAccountModal'

jest.mock('./ui', () => {
  const { Text, Pressable } = require('react-native')
  return {
    Button: ({
      children,
      onPress,
      disabled,
    }: {
      children: React.ReactNode
      onPress?: () => void
      disabled?: boolean
    }) => (
      <Pressable onPress={onPress} disabled={disabled}>
        <Text>{children}</Text>
      </Pressable>
    ),
    Eyebrow: ({ children }: { children: React.ReactNode }) => <Text>{children}</Text>,
  }
})

describe('DeleteAccountModal', () => {
  it('disables the confirm button until the confirmation word is typed', () => {
    const onConfirm = jest.fn()
    const { getByTestId } = render(
      <DeleteAccountModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />,
    )
    const confirmBtn = getByTestId('delete-account-confirm-button')
    fireEvent.press(confirmBtn)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('enables the confirm button after typing BORRAR and calls onConfirm', () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const { getByTestId } = render(
      <DeleteAccountModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.changeText(getByTestId('delete-account-confirm-input'), 'BORRAR')
    fireEvent.press(getByTestId('delete-account-confirm-button'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('accepts the confirmation word case-insensitively', () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined)
    const { getByTestId } = render(
      <DeleteAccountModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.changeText(getByTestId('delete-account-confirm-input'), '  borrar  ')
    fireEvent.press(getByTestId('delete-account-confirm-button'))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('does not call onConfirm with the wrong confirmation word', () => {
    const onConfirm = jest.fn()
    const { getByTestId } = render(
      <DeleteAccountModal
        visible
        onClose={jest.fn()}
        onConfirm={onConfirm}
      />,
    )
    fireEvent.changeText(getByTestId('delete-account-confirm-input'), 'DELETE')
    fireEvent.press(getByTestId('delete-account-confirm-button'))
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('shows the loading state while isPending=true', () => {
    const { getByText } = render(
      <DeleteAccountModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        isPending
      />,
    )
    expect(getByText('Eliminando…')).toBeTruthy()
  })

  it('renders an error message when errorMessage is provided', () => {
    const { getByText } = render(
      <DeleteAccountModal
        visible
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        errorMessage="Algo falló"
      />,
    )
    expect(getByText('Algo falló')).toBeTruthy()
  })
})
