/**
 * DeleteAccountModal — confirms permanent account deletion.
 *
 * Apple Guideline 5.1.1(v) requires an in-app deletion path. UX research
 * shows that destructive irreversible actions need a friction step beyond
 * a single tap: the user must type "BORRAR" (Spanish for "DELETE") before
 * the destructive button enables. This prevents accidental account loss
 * from misclicks, especially on small screens.
 *
 * On confirm we call DELETE /auth/me via `useDeleteAccount`. The hook
 * clears the local session and the React Query cache. The parent screen
 * is responsible for navigation (router.replace to landing/login) and
 * showing the success toast after `onSuccess` fires.
 */

import { useState } from 'react'
import {
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
  ScrollView,
} from 'react-native'
import { Trans, useTranslation } from 'react-i18next'
import { Button, Eyebrow } from './ui'

const CONFIRM_WORD = 'BORRAR'

type Props = {
  visible: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  isPending?: boolean
  errorMessage?: string | null
}

export function DeleteAccountModal({
  visible,
  onClose,
  onConfirm,
  isPending = false,
  errorMessage = null,
}: Props) {
  const { t } = useTranslation('profile')
  const [confirmText, setConfirmText] = useState('')
  const isConfirmed = confirmText.trim().toUpperCase() === CONFIRM_WORD

  const handleClose = () => {
    if (isPending) return
    setConfirmText('')
    onClose()
  }

  const handleConfirm = async () => {
    if (!isConfirmed || isPending) return
    try {
      await onConfirm()
    } finally {
      // Reset the input regardless of whether onConfirm threw, so the
      // modal is clean if the user tries again or closes it.
      setConfirmText('')
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
      presentationStyle="overFullScreen"
    >
      <Pressable
        className="flex-1 bg-ink/40"
        onPress={handleClose}
        accessibilityRole="button"
        accessibilityLabel={t('deleteModal.close')}
      >
        <View className="flex-1" />
      </Pressable>
      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-[20px] bg-paper px-6 pb-10 pt-6"
        style={{ shadowOpacity: 0.2, shadowRadius: 20 }}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          <View className="mx-auto mb-5 h-1 w-12 rounded-full bg-ink/20" />

          <Eyebrow tone="ink">{t('deleteModal.eyebrow')}</Eyebrow>
          <Text className="mt-2 font-sans-semibold text-[24px] text-ink">
            {t('deleteModal.title')}
          </Text>

          <Text className="mt-4 font-sans text-[14px] leading-[20px] text-ink-soft">
            {t('deleteModal.body')}
          </Text>

          <View className="mt-6">
            <Text className="mb-2 font-sans text-[11px] uppercase tracking-eyebrow text-ink-muted">
              <Trans
                t={t}
                i18nKey="deleteModal.typeToConfirm"
                values={{ word: CONFIRM_WORD }}
                components={{
                  bold: <Text className="font-sans-semibold text-bad" />,
                }}
              />
            </Text>
            <TextInput
              className="h-12 border-b border-ink/25 pb-1 font-sans-medium text-[18px] text-ink"
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              value={confirmText}
              onChangeText={setConfirmText}
              editable={!isPending}
              placeholder={CONFIRM_WORD}
              placeholderTextColor="#6B6488"
              accessibilityLabel={t('deleteModal.inputA11y', { word: CONFIRM_WORD })}
              testID="delete-account-confirm-input"
            />
          </View>

          {errorMessage && (
            <Text className="mt-3 font-sans text-[12px] text-bad">
              {errorMessage}
            </Text>
          )}

          <View className="mt-6 flex-row gap-3">
            <View className="flex-1">
              <Button
                variant="outline"
                size="lg"
                onPress={handleClose}
                disabled={isPending}
              >
                {t('deleteModal.cancel')}
              </Button>
            </View>
            <View className="flex-1">
              <Pressable
                onPress={handleConfirm}
                disabled={!isConfirmed || isPending}
                accessibilityRole="button"
                accessibilityState={{ disabled: !isConfirmed || isPending }}
                accessibilityLabel={t('deleteAccountA11y')}
                testID="delete-account-confirm-button"
                className={`h-14 flex-row items-center justify-center rounded-xs px-6 ${
                  !isConfirmed || isPending
                    ? 'bg-bad/40'
                    : 'bg-bad active:opacity-80'
                }`}
              >
                <Text className="font-sans-medium text-[12px] uppercase tracking-label text-paper">
                  {isPending ? t('deleteModal.deleting') : t('deleteModal.confirm')}
                </Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </View>
    </Modal>
  )
}
