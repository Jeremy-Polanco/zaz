import { useState } from 'react'
import { View, Text, ActivityIndicator, ScrollView, Pressable } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { SymbolView, type AndroidSymbol } from 'expo-symbols'
import type { SFSymbol } from 'sf-symbols-typescript'
import { useCurrentUser, useDeleteAccount, useLogout } from '../../lib/queries'
import { Button, Eyebrow, Hairline } from '../../components/ui'
import { DeleteAccountModal } from '../../components/DeleteAccountModal'

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

const ROLE_LABEL: Record<string, string> = {
  client: 'Cliente',
  super_admin_delivery: 'Super Admin · Reparto',
}

export default function ProfileTab() {
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
          ?.response?.data?.message ??
          'No pudimos eliminar tu cuenta. Intenta de nuevo.',
      )
    }
  }

  const initial = user?.fullName?.[0]?.toUpperCase() ?? '·'

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerClassName="px-5 pb-8">
        <View className="pb-2 pt-6">
          <Eyebrow className="mb-3">Tu cuenta</Eyebrow>
          <Text className="font-sans-semibold text-[40px] leading-[44px] text-ink">Perfil.</Text>
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
          <Eyebrow>Rol</Eyebrow>
          <Text className="mt-1.5 font-sans-semibold text-[18px] text-ink">
            {user?.role ? ROLE_LABEL[user.role] : '—'}
          </Text>
        </View>

        {user?.phone && (
          <View className="mt-6">
            <Eyebrow>Teléfono</Eyebrow>
            <Text
              className="mt-1.5 font-sans-medium text-[16px] text-ink"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {user.phone}
            </Text>
          </View>
        )}

        {isClient && (
          <>
            <Hairline className="mt-10" />
            <View className="mt-6">
              <Eyebrow className="mb-1">Mis datos</Eyebrow>
              <AccountLink
                label="Mis alquileres"
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
              <Eyebrow className="mb-1">Mi actividad</Eyebrow>
              <AccountLink
                label="Puntos"
                iosIcon="star.fill"
                androidIcon="star"
                href="/(tabs)/points"
              />
              <AccountLink
                label="Suscripción"
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
              Cuenta eliminada. Te vamos a extrañar.
            </Text>
          </View>
        )}

        <Hairline className="mt-10" />

        <View className="mt-8">
          <Button variant="outline" size="lg" onPress={handleLogout}>
            Cerrar sesión →
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
            accessibilityLabel="Eliminar mi cuenta permanentemente"
            testID="delete-account-button"
            className="h-14 flex-row items-center justify-center border border-bad/40 px-6 active:bg-bad/5"
          >
            <Text className="font-sans-medium text-[14px] uppercase tracking-label text-bad">
              Eliminar mi cuenta
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
