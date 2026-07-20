import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { savedAddressSchema, type SavedAddressInput } from '../../lib/schemas'
import {
  useMyAddresses,
  useUpdateAddress,
  useDeleteAddress,
  useSetDefaultAddress,
} from '../../lib/queries'
import { MapPicker } from '../../components/MapPicker'
import { ScreenHeader } from '../../components/ScreenHeader'

export default function EditAddress() {
  const { t } = useTranslation('addresses')
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: addresses, isPending: isLoading } = useMyAddresses()
  const updateAddress = useUpdateAddress()
  const deleteAddress = useDeleteAddress()
  const setDefaultAddress = useSetDefaultAddress()

  const address = addresses?.find((a) => a.id === id)

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SavedAddressInput>({
    resolver: zodResolver(savedAddressSchema),
    values: address
      ? {
          label: address.label,
          line1: address.line1,
          line2: address.line2 ?? undefined,
          lat: address.lat,
          lng: address.lng,
          instructions: address.instructions ?? undefined,
        }
      : undefined,
  })

  const lat = watch('lat') ?? 18.4861
  const lng = watch('lng') ?? -69.9312

  if (isLoading) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <Stack.Screen options={{ title: t('edit.title') }} />
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  if (!address) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <Stack.Screen options={{ title: t('edit.fallbackTitle') }} />
        <Text className="text-[16px] text-ink-soft">{t('edit.notFound')}</Text>
      </SafeAreaView>
    )
  }

  const onSubmit = async (values: SavedAddressInput) => {
    await updateAddress.mutateAsync({ id, ...values })
    router.replace('/addresses' as never)
  }

  const handleDelete = () => {
    Alert.alert(
      t('edit.delete'),
      t('edit.deleteConfirm', { label: address.label }),
      [
        { text: t('edit.deleteCancel'), style: 'cancel' },
        {
          text: t('edit.deleteOk'),
          style: 'destructive',
          onPress: async () => {
            await deleteAddress.mutateAsync(id)
            router.replace('/addresses' as never)
          },
        },
      ],
    )
  }

  const handleSetDefault = async () => {
    await setDefaultAddress.mutateAsync(id)
  }

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-paper">
      <Stack.Screen options={{ title: t('edit.title') }} />
      <ScreenHeader title={t('edit.title')} />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="px-5 py-6 gap-5"
          keyboardShouldPersistTaps="handled"
        >
          {/* Label */}
          <View className="gap-1.5">
            <Text className="font-sans-medium text-[15px] uppercase tracking-wide text-ink-soft">
              {t('form.name')}
            </Text>
            <Controller
              control={control}
              name="label"
              render={({ field }) => (
                <TextInput
                  className="rounded-lg border border-ink/20 bg-paper px-4 py-3 text-[16px] text-ink"
                  placeholder={t('form.namePlaceholder')}
                  placeholderTextColor="#9ca3af"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  returnKeyType="next"
                />
              )}
            />
            {errors.label && (
              <Text className="text-[15px] text-red-500">{errors.label.message}</Text>
            )}
          </View>

          {/* Line 1 */}
          <View className="gap-1.5">
            <Text className="font-sans-medium text-[15px] uppercase tracking-wide text-ink-soft">
              {t('form.address')}
            </Text>
            <Controller
              control={control}
              name="line1"
              render={({ field }) => (
                <TextInput
                  className="rounded-lg border border-ink/20 bg-paper px-4 py-3 text-[16px] text-ink"
                  placeholder={t('form.addressPlaceholder')}
                  placeholderTextColor="#9ca3af"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  returnKeyType="next"
                />
              )}
            />
            {errors.line1 && (
              <Text className="text-[15px] text-red-500">{errors.line1.message}</Text>
            )}
          </View>

          {/* Line 2 */}
          <View className="gap-1.5">
            <Text className="font-sans-medium text-[15px] uppercase tracking-wide text-ink-soft">
              {t('form.unit')}{' '}
              <Text className="normal-case font-sans text-[13px]">{t('form.optional')}</Text>
            </Text>
            <Controller
              control={control}
              name="line2"
              render={({ field }) => (
                <TextInput
                  className="rounded-lg border border-ink/20 bg-paper px-4 py-3 text-[16px] text-ink"
                  placeholder={t('form.unitPlaceholder')}
                  placeholderTextColor="#9ca3af"
                  value={field.value ?? ''}
                  onChangeText={(v) => field.onChange(v || undefined)}
                  onBlur={field.onBlur}
                  returnKeyType="next"
                />
              )}
            />
          </View>

          {/* Map Picker */}
          <View className="gap-1.5">
            <Text className="font-sans-medium text-[15px] uppercase tracking-wide text-ink-soft">
              {t('form.pinLabel')}
            </Text>
            <MapPicker
              value={{ lat, lng }}
              onChange={({ lat: newLat, lng: newLng }) => {
                setValue('lat', newLat)
                setValue('lng', newLng)
              }}
            />
          </View>

          {/* Instructions */}
          <View className="gap-1.5">
            <Text className="font-sans-medium text-[15px] uppercase tracking-wide text-ink-soft">
              {t('form.instructions')}{' '}
              <Text className="normal-case font-sans text-[13px]">{t('form.optional')}</Text>
            </Text>
            <Controller
              control={control}
              name="instructions"
              render={({ field }) => (
                <TextInput
                  className="rounded-lg border border-ink/20 bg-paper px-4 py-3 text-[16px] text-ink"
                  placeholder={t('form.instructionsPlaceholder')}
                  placeholderTextColor="#9ca3af"
                  value={field.value ?? ''}
                  onChangeText={(v) => field.onChange(v || undefined)}
                  onBlur={field.onBlur}
                  multiline
                  numberOfLines={3}
                  returnKeyType="done"
                />
              )}
            />
          </View>

          {/* Save button */}
          <Pressable
            onPress={handleSubmit(onSubmit)}
            disabled={updateAddress.isPending}
            className="mt-2 items-center rounded-xl bg-brand py-4 active:opacity-70 disabled:opacity-50"
          >
            {updateAddress.isPending ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text className="font-sans-semibold text-[16px] text-paper">
                {t('edit.save')}
              </Text>
            )}
          </Pressable>

          {/* Set default button */}
          <Pressable
            onPress={handleSetDefault}
            disabled={setDefaultAddress.isPending || address.isDefault}
            className="items-center rounded-xl border border-brand py-4 active:opacity-70 disabled:opacity-40"
          >
            <Text className="font-sans-semibold text-[16px] text-brand">
              {address.isDefault ? t('edit.isDefault') : t('edit.makeDefault')}
            </Text>
          </Pressable>

          {/* Delete button */}
          <Pressable
            onPress={handleDelete}
            disabled={deleteAddress.isPending}
            className="items-center py-4 active:opacity-60"
          >
            <Text className="font-sans-medium text-[15px] text-red-500">
              {t('edit.delete')}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
