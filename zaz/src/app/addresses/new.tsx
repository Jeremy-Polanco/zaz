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
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { savedAddressSchema, type SavedAddressInput } from '../../lib/schemas'
import { useCreateAddress } from '../../lib/queries'
import { MapPicker } from '../../components/MapPicker'

const FALLBACK_LAT = 18.4861
const FALLBACK_LNG = -69.9312

export default function NewAddress() {
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
      <Stack.Screen options={{ title: 'Nueva dirección' }} />
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
            <Text className="font-sans-medium text-[13px] uppercase tracking-wide text-ink-soft">
              Nombre
            </Text>
            <Controller
              control={control}
              name="label"
              render={({ field }) => (
                <TextInput
                  className="rounded-lg border border-ink/20 bg-paper px-4 py-3 text-[16px] text-ink"
                  placeholder="Ej: Casa, Oficina"
                  placeholderTextColor="#9ca3af"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  returnKeyType="next"
                />
              )}
            />
            {errors.label && (
              <Text className="text-[13px] text-red-500">{errors.label.message}</Text>
            )}
          </View>

          {/* Line 1 */}
          <View className="gap-1.5">
            <Text className="font-sans-medium text-[13px] uppercase tracking-wide text-ink-soft">
              Dirección
            </Text>
            <Controller
              control={control}
              name="line1"
              render={({ field }) => (
                <TextInput
                  className="rounded-lg border border-ink/20 bg-paper px-4 py-3 text-[16px] text-ink"
                  placeholder="Av. 27 de Febrero 123"
                  placeholderTextColor="#9ca3af"
                  value={field.value}
                  onChangeText={field.onChange}
                  onBlur={field.onBlur}
                  returnKeyType="next"
                />
              )}
            />
            {errors.line1 && (
              <Text className="text-[13px] text-red-500">{errors.line1.message}</Text>
            )}
          </View>

          {/* Line 2 (optional) */}
          <View className="gap-1.5">
            <Text className="font-sans-medium text-[13px] uppercase tracking-wide text-ink-soft">
              Apto / Piso{' '}
              <Text className="normal-case font-sans text-[11px]">(opcional)</Text>
            </Text>
            <Controller
              control={control}
              name="line2"
              render={({ field }) => (
                <TextInput
                  className="rounded-lg border border-ink/20 bg-paper px-4 py-3 text-[16px] text-ink"
                  placeholder="Apto 3B, Piso 5"
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
            <Text className="font-sans-medium text-[13px] uppercase tracking-wide text-ink-soft">
              Ubica el pin
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
            <Text className="font-sans-medium text-[13px] uppercase tracking-wide text-ink-soft">
              Instrucciones{' '}
              <Text className="normal-case font-sans text-[11px]">(opcional)</Text>
            </Text>
            <Controller
              control={control}
              name="instructions"
              render={({ field }) => (
                <TextInput
                  className="rounded-lg border border-ink/20 bg-paper px-4 py-3 text-[16px] text-ink"
                  placeholder="Toca el portón, apartamento en el fondo"
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
                Guardar dirección
              </Text>
            )}
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
