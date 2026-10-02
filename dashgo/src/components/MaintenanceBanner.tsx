import { useMemo } from 'react'
import { View, Text } from 'react-native'
import { useTranslation } from 'react-i18next'
import { router } from 'expo-router'
import { useMyRentals, useProducts, useRequestMaintenance } from '../lib/queries'
import { formatDeliveryDay } from '../lib/format'
import { Button } from './ui'

/** Whole days from now until `iso` (negative when overdue). */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

/**
 * Bebedero maintenance countdown.
 *
 * Shows a 90-day countdown for the customer's most-due active rental that
 * tracks maintenance. When it expires the SYSTEM creates the maintenance visit
 * by itself (MaintenanceCron), so while a visit is open the banner just tells
 * the customer which day it's scheduled for, with a link to the order — a calm
 * notice, not an alert. Only when there's no scheduled visit does an expired
 * countdown fall back to the alert with a one-tap button to request it
 * manually. Renders nothing when the customer has no maintenance-tracked rental.
 */
export function MaintenanceBanner() {
  const { t, i18n } = useTranslation('banners')
  const { data: rentals } = useMyRentals()
  const { data: products } = useProducts()
  const requestMaintenance = useRequestMaintenance()

  // Most urgent rental = earliest nextMaintenanceAt among active, tracked ones.
  const due = useMemo(() => {
    const tracked = (rentals ?? []).filter(
      (r) => r.status === 'active' && r.nextMaintenanceAt,
    )
    if (tracked.length === 0) return null
    return tracked.reduce((a, b) =>
      new Date(a.nextMaintenanceAt!).getTime() <=
      new Date(b.nextMaintenanceAt!).getTime()
        ? a
        : b,
    )
  }, [rentals])

  const maintenanceProduct = useMemo(
    () => (products ?? []).find((p) => p.isMaintenanceService && p.isAvailable),
    [products],
  )

  if (!due) return null

  // Visita ya generada por el sistema: tiene prioridad sobre la cuenta
  // regresiva y sobre la alerta de vencido (pedir otra no tendría sentido).
  if (due.maintenanceOrderId && due.maintenanceScheduledFor) {
    const orderId = due.maintenanceOrderId
    return (
      <View className="mt-6 border-l-4 border-ink bg-paper-deep/40 p-4">
        <Text className="font-sans-semibold text-[16px] text-ink">
          {t('maintenance.title')}
        </Text>
        <Text className="mt-2 font-sans-semibold text-[14px] text-ink">
          {t('maintenance.scheduledFor', {
            day: formatDeliveryDay(due.maintenanceScheduledFor, i18n.language),
          })}
        </Text>
        <Button
          variant="outline"
          onPress={() =>
            router.push({
              pathname: '/orders/[orderId]',
              params: { orderId },
            })
          }
          className="mt-3"
        >
          {t('maintenance.viewOrder')}
        </Button>
      </View>
    )
  }

  const daysLeft = daysUntil(due.nextMaintenanceAt!)
  const overdue = daysLeft <= 0

  const onRequest = async () => {
    if (!maintenanceProduct) return
    try {
      const order = await requestMaintenance.mutateAsync(maintenanceProduct.id)
      router.push({
        pathname: '/orders/[orderId]',
        params: { orderId: order.id },
      })
    } catch {
      /* surfaced below via mutation state */
    }
  }

  if (!overdue) {
    return (
      <View className="mt-6 border-l-4 border-ink bg-paper-deep/40 p-4">
        <Text className="font-sans-semibold text-[16px] text-ink">
          {t('maintenance.title')}
        </Text>
        <Text className="mt-2 font-sans text-[13px] text-ink-soft">
          {t('maintenance.upcomingPrefix')}{' '}
          <Text className="font-sans-semibold text-[15px] text-ink">{daysLeft}</Text>{' '}
          {t('maintenance.days', { count: daysLeft })}.
        </Text>
      </View>
    )
  }

  const overdueDays = Math.abs(daysLeft)
  const errorMessage =
    (
      requestMaintenance.error as
        | { response?: { data?: { message?: string } } }
        | null
        | undefined
    )?.response?.data?.message ?? t('maintenance.createOrderError')

  return (
    <View className="mt-6 border-l-4 border-bad bg-bad/10 p-4">
      <Text className="font-sans-semibold text-[18px] text-ink">
        {t('maintenance.overdueTitle')}
      </Text>
      <Text className="mt-2 font-sans text-[13px] text-ink-soft">
        {overdueDays === 0 ? (
          <>{t('maintenance.dueToday')} </>
        ) : (
          <>
            {t('maintenance.overduePrefix')}{' '}
            <Text className="font-sans-semibold text-[15px] text-ink">{overdueDays}</Text>{' '}
            {t('maintenance.days', { count: overdueDays })}.{' '}
          </>
        )}
        {t('maintenance.requestVisit')}
      </Text>
      {maintenanceProduct ? (
        <Button
          variant="accent"
          size="lg"
          onPress={onRequest}
          loading={requestMaintenance.isPending}
          className="mt-4"
        >
          {t('maintenance.requestCta')}
        </Button>
      ) : (
        <Text className="mt-3 font-sans text-[12px] text-ink-muted">
          {t('maintenance.contactSupport')}
        </Text>
      )}
      {requestMaintenance.isError ? (
        <Text className="mt-3 font-sans text-[12px] text-bad">{errorMessage}</Text>
      ) : null}
    </View>
  )
}
