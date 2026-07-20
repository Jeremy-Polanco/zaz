import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router, Stack } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { savedAddressSchema, type SavedAddressInput } from '../../lib/schemas'
import { useCreateAddress } from '../../lib/queries'
import { MapPicker } from '../../components/MapPicker'
import { ScreenHeader } from '../../components/ScreenHeader'

const FALLBACK_LAT = 18.4861
const FALLBACK_LNG = -69.9312

export default function NewAddress() {
  const { t } = useTranslation('addresses')
  const createAddress = useCreateAddress()

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<SavedAddressInput>({
    resolver: zodResolver(savedAddressSchema),
    defaultValues: {
      label: '',
      line1: '',
      line2: undefined,
      lat: FALLBACK_LAT,
      lng: FALLBACK_LNG,
      instructions: undefined,
    },
  })

  const lat = watch('lat')
  const lng = watch('lng')

  const onSubmit = async (values: SavedAddressInput) => {
    await createAddress.mutateAsync(values)
    router.replace('/addresses' as never)
  }

  return (
    <SafeAreaView edges={['bottom']} className="flex-1 bg-paper">
      <Stack.Screen options={{ title: t('new.title') }} />
      <ScreenHeader title={t('new.title')} />
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

          {/* Line 2 (optional) */}
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

          {/* Instructions (optional) */}
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

          {/* Submit */}
          <Pressable
            onPress={handleSubmit(onSubmit)}
            disabled={createAddress.isPending}
            className="mt-2 items-center rounded-xl bg-brand py-4 active:opacity-70 disabled:opacity-50"
          >
            {createAddress.isPending ? (
              <ActivityIndicator color="#ffffff" size="small" />
            ) : (
              <Text className="font-sans-semibold text-[16px] text-paper">
                {t('new.submit')}
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
