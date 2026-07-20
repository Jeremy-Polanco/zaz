import { useState } from 'react'
import {
  View,
  Text,
  ActivityIndicator,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { SymbolView, type AndroidSymbol } from 'expo-symbols'
import type { SFSymbol } from 'sf-symbols-typescript'
import {
  useCurrentUser,
  useDeleteAccount,
  useLogout,
  useUpdateMe,
} from '../../lib/queries'
import { dobToIso, dobSchema } from '../../lib/schemas'
import { Button, Eyebrow, Hairline } from '../../components/ui'
import { DeleteAccountModal } from '../../components/DeleteAccountModal'
import { setAppLanguage, type AppLanguage } from '../../i18n'

/**
 * Birthday row — clients without a saved birthday get an inline DD/MM/AAAA
 * input (drives the birthday greeting + gift); once saved it renders
 * read-only. Kept inline: it's one field, a full edit screen would be noise.
 */
function BirthdayRow({ dateOfBirth }: { dateOfBirth: string | null | undefined }) {
  const { t } = useTranslation('profile')
  const updateMe = useUpdateMe()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (dateOfBirth) {
    const [y, m, d] = dateOfBirth.split('-')
    return (
      <View className="mt-6">
        <Eyebrow>{t('birthday.label')}</Eyebrow>
        <Text
          className="mt-1.5 font-sans-medium text-[16px] text-ink"
          style={{ fontVariant: ['tabular-nums'] }}
        >
          {d}/{m}/{y} 🎂
        </Text>
      </View>
    )
  }

  const save = async () => {
    const parsed = dobSchema.safeParse(value)
    if (!parsed.success || !value) {
      setError(t('birthday.formatError'))
      return
    }
    setError(null)
    try {
      await updateMe.mutateAsync({ dateOfBirth: dobToIso(value) })
    } catch {
      setError(t('birthday.saveError'))
    }
  }

  return (
    <View className="mt-6">
      <Eyebrow>{t('birthday.label')}</Eyebrow>
      <View className="mt-1.5 flex-row items-end gap-3">
        <TextInput
          className="h-11 flex-1 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
          keyboardType="number-pad"
          placeholder={t('birthday.placeholder')}
          placeholderTextColor="#6B6488"
          maxLength={10}
          value={value}
          onChangeText={(raw) => {
            const digits = raw.replace(/\D/g, '').slice(0, 8)
            let out = digits
            if (digits.length > 4) {
              out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
            } else if (digits.length > 2) {
              out = `${digits.slice(0, 2)}/${digits.slice(2)}`
            }
            setValue(out)
          }}
        />
        <Button
          size="md"
          variant="outline"
          onPress={save}
          loading={updateMe.isPending}
          disabled={value.length < 10}
        >
          {t('birthday.save')}
        </Button>
      </View>
      <Text className="mt-1.5 font-sans text-[12px] text-ink-muted">
        {t('birthday.hint')}
      </Text>
      {error && (
        <Text className="mt-1 font-sans text-[12px] text-bad">{error}</Text>
      )}
    </View>
  )
}

type AccountLinkProps = {
  label: string
  iosIcon: SFSymbol
  androidIcon: AndroidSymbol
  href: string
}

function AccountLink({ label, iosIcon, androidIcon, href }: AccountLinkProps) {
  return (
    <Pressable
      onPress={() => router.navigate(href as never)}
      className="flex-row items-center justify-between py-4 active:opacity-60"
    >
      <View className="flex-row items-center gap-3">
        <SymbolView
          name={{ ios: iosIcon, android: androidIcon }}
          size={22}
          tintColor="#1a1a1a"
          resizeMode="scaleAspectFit"
          fallback={<Text style={{ fontSize: 18 }}>•</Text>}
        />
        <Text className="font-sans-medium text-[16px] text-ink">{label}</Text>
      </View>
      <SymbolView
        name={{ ios: 'chevron.right', android: 'chevron_right' }}
        size={16}
        tintColor="#6B6488"
        resizeMode="scaleAspectFit"
        fallback={<Text style={{ fontSize: 16, color: '#6B6488' }}>›</Text>}
      />
    </Pressable>
  )
}

/** Maps API roles to their i18n keys in the `profile` namespace. */
const ROLE_LABEL_KEY: Record<string, string> = {
  client: 'roles.client',
  super_admin_delivery: 'roles.superAdminDelivery',
}

const LANGUAGES: { code: AppLanguage; label: string }[] = [
  // Language endonyms are proper nouns — never translated.
  { code: 'es', label: 'Español' },
  { code: 'en', label: 'English' },
]

export default function ProfileTab() {
  const { t, i18n } = useTranslation('profile')
  const { data: user, isPending } = useCurrentUser()
  const logout = useLogout()
  const deleteAccount = useDeleteAccount()
  const isClient = user?.role === 'client'

  const [deleteModalOpen, setDeleteModalOpen] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [successToast, setSuccessToast] = useState(false)

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  const handleLogout = async () => {
    await logout()
    router.replace('/(auth)/login')
  }

  const handleDeleteConfirm = async () => {
    setDeleteError(null)
    try {
      await deleteAccount.mutateAsync()
      setDeleteModalOpen(false)
      setSuccessToast(true)
      // Brief delay so the user sees confirmation before navigation.
      setTimeout(() => {
        setSuccessToast(false)
        router.replace('/(auth)/login')
      }, 1200)
    } catch (err) {
      setDeleteError(
        (err as Error & { response?: { data?: { message?: string } } })
          ?.response?.data?.message ?? t('deleteError'),
      )
    }
  }

  const initial = user?.fullName?.[0]?.toUpperCase() ?? '·'

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pb-8">
        <View className="pb-2 pt-6">
          <Eyebrow className="mb-3">{t('eyebrow')}</Eyebrow>
          <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">{t('title')}</Text>
          <Hairline className="mt-6" />
        </View>

        {/* Identity block */}
        <View className="mt-6 flex-row items-center gap-5">
          <View className="h-16 w-16 items-center justify-center bg-ink">
            <Text className="font-sans-semibold text-3xl text-paper">{initial}</Text>
          </View>
          <View className="flex-1">
            <Text className="font-sans-semibold text-[22px] leading-[26px] text-ink">
              {user?.fullName ?? '—'}
            </Text>
            <Text className="mt-0.5 text-[15px] text-ink-soft">{user?.phone ?? ''}</Text>
          </View>
        </View>

        <View className="mt-8">
          <Eyebrow>{t('role')}</Eyebrow>
          <Text className="mt-1.5 font-sans-semibold text-[18px] text-ink">
            {user?.role && ROLE_LABEL_KEY[user.role]
              ? t(ROLE_LABEL_KEY[user.role])
              : '—'}
          </Text>
        </View>

        {user?.phone && (
          <View className="mt-6">
            <Eyebrow>{t('phone')}</Eyebrow>
            <Text
              className="mt-1.5 font-sans-medium text-[16px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {user.phone}
            </Text>
          </View>
        )}

        {isClient && <BirthdayRow dateOfBirth={user?.dateOfBirth} />}

        {isClient && (
          <>
            <Hairline className="mt-10" />
            <View className="mt-6">
              <Eyebrow className="mb-1">{t('myData')}</Eyebrow>
              <AccountLink
                label={t('myRentals')}
                iosIcon="arrow.clockwise.circle.fill"
                androidIcon="autorenew"
                href="/rentals"
              />
            </View>
          </>
        )}

        {isClient && (
          <>
            <Hairline className="mt-10" />
            <View className="mt-6">
              <Eyebrow className="mb-1">{t('myActivity')}</Eyebrow>
              <AccountLink
                label={t('points')}
                iosIcon="star.fill"
                androidIcon="star"
                href="/(tabs)/points"
              />
              <AccountLink
                label={t('subscription')}
                iosIcon="repeat.circle.fill"
                androidIcon="autorenew"
                href="/(tabs)/subscription"
              />
            </View>
          </>
        )}

        {successToast && (
          <View className="mt-6 border border-ok/40 bg-ok/10 px-4 py-3">
            <Text className="font-sans text-[14px] text-ok">
              {t('deletedToast')}
            </Text>
          </View>
        )}

        {/* Language switch — persists via setAppLanguage and re-renders the
            whole app instantly (react-i18next re-render on languageChanged). */}
        <Hairline className="mt-10" />
        <View className="mt-6">
          <Eyebrow className="mb-3">{t('language.title')}</Eyebrow>
          <View className="flex-row gap-3">
            {LANGUAGES.map(({ code, label }) => {
              const active =
                code === 'en'
                  ? i18n.language.startsWith('en')
                  : !i18n.language.startsWith('en')
              return (
                <Pressable
                  key={code}
                  onPress={() => void setAppLanguage(code)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  testID={`language-${code}`}
                  className={`h-11 flex-1 items-center justify-center border ${
                    active
                      ? 'border-ink bg-ink'
                      : 'border-ink/25 bg-paper active:bg-paper-deep'
                  }`}
                >
                  <Text
                    className={`font-sans-medium text-[14px] ${
                      active ? 'text-paper' : 'text-ink'
                    }`}
                  >
                    {label}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        </View>

        <Hairline className="mt-10" />

        <View className="mt-8">
          <Button variant="outline" size="lg" onPress={handleLogout}>
            {t('logout')}
          </Button>
        </View>

        {/* Apple 5.1.1(v) — in-app account deletion. Visible to every signed-in
            user (not gated by role), in destructive style, sufficiently below
            the logout action to discourage misclicks. */}
        <View className="mt-4">
          <Pressable
            onPress={() => {
              setDeleteError(null)
              setDeleteModalOpen(true)
            }}
            accessibilityRole="button"
            accessibilityLabel={t('deleteAccountA11y')}
            testID="delete-account-button"
            className="h-14 flex-row items-center justify-center border border-bad/40 px-6 active:bg-bad/5"
          >
            <Text className="font-sans-medium text-[14px] uppercase tracking-label text-bad">
              {t('deleteAccount')}
            </Text>
          </Pressable>
        </View>
      </ScrollView>

      <DeleteAccountModal
        visible={deleteModalOpen}
        onClose={() => setDeleteModalOpen(false)}
        onConfirm={handleDeleteConfirm}
        isPending={deleteAccount.isPending}
        errorMessage={deleteError}
      />
    </SafeAreaView>
  )
}
