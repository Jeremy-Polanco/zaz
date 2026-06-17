import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  useAdminSubscriptionPlan,
  useUpdateSubscriptionPlan,
} from '../../lib/queries'
import { TAX_RATE, computeGrossCents } from '../../lib/tax'
import { formatCents } from '../../lib/format'
import {
  Button,
  BreakdownRow,
  Card,
  FieldError,
  FieldLabel,
  SectionHead,
} from '../../components/ui'

const TAX_PERCENT_LABEL = `${(TAX_RATE * 100).toFixed(3)}%`

export default function SuperSubscriptionScreen() {
  const { data: plan, isPending } = useAdminSubscriptionPlan()
  const updatePlan = useUpdateSubscriptionPlan()

  const [priceInput, setPriceInput] = useState('')
  const [initialized, setInitialized] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (plan && !initialized) {
      setPriceInput((plan.unitAmountCents / 100).toFixed(2))
      setInitialized(true)
    }
  }, [plan, initialized])

  if (isPending || !plan) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#1A1530" size="small" />
      </SafeAreaView>
    )
  }

  const parsed = Number(priceInput)
  const validFormat = /^\d+(\.\d{1,2})?$/.test(priceInput)
  const valid =
    validFormat && Number.isFinite(parsed) && parsed >= 1 && parsed <= 1000
  const netCents = valid ? Math.round(parsed * 100) : 0
  const grossCents = valid ? computeGrossCents(netCents) : 0
  const unchanged = valid && netCents === plan.unitAmountCents

  const validationError =
    priceInput === ''
      ? undefined
      : !valid
        ? 'Ingresá un monto válido entre $1.00 y $1000.00 (máx. 2 decimales).'
        : undefined

  const handleSubmit = async () => {
    setSuccess(false)
    setError(null)
    if (!valid) return
    try {
      await updatePlan.mutateAsync({ unitAmountCents: netCents })
      setPriceInput((netCents / 100).toFixed(2))
      setSuccess(true)
    } catch (e) {
      setError(
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo actualizar el precio.',
      )
    }
  }

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          contentContainerClassName="px-5 pb-16 pt-6"
          keyboardShouldPersistTaps="handled"
        >
          <SectionHead
            eyebrow="Panel · Suscripción"
            title="Plan"
            italicTail="mensual."
            subtitle="Editá el precio neto. El cliente paga el monto con impuesto incluido."
          />

          {/* Current plan */}
          <Card className="mb-6">
            <BreakdownRow
              label="Precio neto (sin impuesto)"
              value={formatCents(plan.unitAmountCents)}
            />
            <BreakdownRow
              label={`Impuesto (${TAX_PERCENT_LABEL})`}
              value={formatCents(plan.grossAmountCents - plan.unitAmountCents)}
              emphasis="muted"
            />
            <View className="mt-1 border-t border-ink/10 pt-2">
              <BreakdownRow
                label="El cliente paga"
                value={`${formatCents(plan.grossAmountCents)} / ${plan.interval === 'month' ? 'mes' : plan.interval}`}
              />
            </View>
          </Card>

          {/* Editor */}
          <FieldLabel>Nuevo precio mensual (neto, USD)</FieldLabel>
          <TextInput
            className="h-12 border-b border-ink/25 pb-1 font-sans text-[20px] text-ink"
            keyboardType="decimal-pad"
            placeholder="10.00"
            placeholderTextColor="#6B6488"
            value={priceInput}
            onChangeText={(t) => {
              setPriceInput(t)
              setSuccess(false)
              setError(null)
            }}
          />
          <FieldError message={validationError} />

          {valid ? (
            <View className="mt-4 border border-ink/15 bg-paper-deep p-4">
              <Text className="font-sans text-[10px] uppercase tracking-label text-ink-muted">
                Vista previa
              </Text>
              <Text
                className="mt-1 font-sans-semibold text-[18px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                El cliente pagará {formatCents(grossCents)} / mes
              </Text>
              <Text className="mt-0.5 font-sans text-[12px] text-ink-soft">
                Neto {formatCents(netCents)} + impuesto {TAX_PERCENT_LABEL}
              </Text>
            </View>
          ) : null}

          {success ? (
            <View className="mt-4 border border-ok/40 bg-ok/10 px-4 py-3">
              <Text className="font-sans text-[12px] text-ok">
                Precio actualizado correctamente.
              </Text>
            </View>
          ) : null}
          {error ? (
            <View className="mt-4 border border-bad/40 bg-bad/10 px-4 py-3">
              <Text className="font-sans text-[12px] text-bad">{error}</Text>
            </View>
          ) : null}

          <View className="mt-6">
            <Button
              variant="accent"
              size="lg"
              onPress={handleSubmit}
              loading={updatePlan.isPending}
              disabled={!valid || unchanged}
            >
              Guardar precio →
            </Button>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
