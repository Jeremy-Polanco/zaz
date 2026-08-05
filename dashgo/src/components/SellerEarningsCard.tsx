import { View, Text } from 'react-native'
import { formatCents } from '../lib/format'
import type { SellerEarnings } from '../lib/types'

/**
 * Ingresos de un vendedor. Espejo de dashgo-web/src/components/SellerEarningsCard.
 *
 * El desglose por método de pago va SIEMPRE visible, no escondido: con tarjeta
 * la plata entró a la empresa y se le debe la comisión; en efectivo alguien ya
 * agarró los billetes. Leer solo el total es cómo se paga de más.
 */
export function SellerEarningsCard({
  earnings,
  compact = false,
}: {
  earnings: SellerEarnings
  compact?: boolean
}) {
  const { byPaymentMethod } = earnings
  const rows = [
    { label: 'Por tarjeta', data: byPaymentMethod.card, hint: 'la empresa cobró' },
    { label: 'En efectivo', data: byPaymentMethod.cash, hint: 'se cobró en mano' },
    {
      label: 'Sin registrar',
      data: byPaymentMethod.unknown,
      hint: 'comisiones viejas',
    },
  ].filter(
    (r) => r.data.pendingCents + r.data.claimableCents + r.data.paidCents > 0,
  )

  return (
    <View className="gap-3">
      <View className="flex-row gap-2">
        <Stat label="A cobrar" cents={earnings.claimableCents} strong />
        <Stat label="En espera" cents={earnings.pendingCents} />
        <Stat label="Pagado" cents={earnings.paidCents} />
      </View>

      {rows.length > 0 ? (
        <View className="border border-ink/10">
          <Text className="border-b border-ink/10 px-3 py-2 font-sans text-[10px] uppercase tracking-label text-ink-muted">
            Cómo pagó el cliente
          </Text>
          {rows.map((r) => (
            <View
              key={r.label}
              className="flex-row items-center justify-between gap-3 border-b border-ink/5 px-3 py-2"
            >
              <View className="flex-1">
                <Text className="font-sans text-[14px] text-ink">{r.label}</Text>
                <Text className="font-sans text-[11px] text-ink-muted">
                  {r.hint}
                </Text>
              </View>
              <Text
                className="font-sans-semibold text-[14px] text-ink"
                style={{ fontVariant: ['tabular-nums'] }}
              >
                {formatCents(r.data.claimableCents)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}

      {!compact ? (
        <Text className="font-sans text-[11px] leading-snug text-ink-muted">
          Las comisiones pasan a “A cobrar” a los 90 días de la entrega. La
          columna de la derecha es lo cobrable de cada tipo.
        </Text>
      ) : null}
    </View>
  )
}

function Stat({
  label,
  cents,
  strong = false,
}: {
  label: string
  cents: number
  strong?: boolean
}) {
  return (
    <View
      className={`flex-1 border px-3 py-2 ${
        strong ? 'border-accent-dark bg-accent-light' : 'border-ink/10 bg-paper'
      }`}
    >
      <Text className="font-sans text-[9px] uppercase tracking-label text-ink-muted">
        {label}
      </Text>
      <Text
        className="mt-0.5 font-sans-semibold text-[18px] text-ink"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {formatCents(cents)}
      </Text>
    </View>
  )
}
