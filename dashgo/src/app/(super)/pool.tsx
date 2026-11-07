import { ActivityIndicator, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { usePoolDistributions, usePoolSummary } from '../../lib/queries'
import { formatCents } from '../../lib/format'
import { formatDistributionDate, quarterLabelEs } from '../../lib/pool'
import { Card, Eyebrow, Nums, SectionHead } from '../../components/ui'

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="mt-3 flex-row items-baseline justify-between">
      <Text className="font-sans text-[12px] uppercase tracking-label text-ink-muted">
        {label}
      </Text>
      <Nums className="font-sans-semibold text-[17px]">{value}</Nums>
    </View>
  )
}

/**
 * Panel del pool (solo super admin): el trimestre en curso y los repartos
 * ya hechos. El acceso lo decide la API (`/pool/summary` y
 * `/pool/distributions` son de super admin); el ítem del menú solo aparece
 * en la lista del super admin, no en la del vendedor.
 */
export default function SuperPoolScreen() {
  const { data: summary } = usePoolSummary(true)
  const { data: distributions, isPending } = usePoolDistributions()

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 48 }}>
        <SectionHead eyebrow="Panel" title="Pool de asociados" />

        {summary && (
          <Card className="mb-8">
            <Eyebrow>{quarterLabelEs(summary.quarter)} · en curso</Eyebrow>
            <Stat label="Pool" value={formatCents(summary.poolCents)} />
            <Stat label="Asociados" value={String(summary.associateCount)} />
            <Stat
              label="Parte estimada"
              value={formatCents(summary.estimatedShareCents)}
            />
            <Stat
              label="Próximo reparto"
              value={formatDistributionDate(summary.nextDistributionAt, 'es')}
            />
          </Card>
        )}

        <Eyebrow className="mb-3">Repartos</Eyebrow>
        {isPending || !distributions ? (
          <ActivityIndicator color="#1A1530" size="small" />
        ) : distributions.length === 0 ? (
          <Text className="text-[14px] text-ink-muted">
            Aún no se hizo ningún reparto.
          </Text>
        ) : (
          distributions.map((d) => (
            <Card
              key={d.id}
              testID={`distribution-${d.quarter}`}
              className="mb-3"
            >
              <Text className="font-sans-semibold text-[16px] text-ink">
                {quarterLabelEs(d.quarter)}
              </Text>
              <Stat label="Total" value={formatCents(d.totalCents)} />
              <Stat label="Asociados" value={String(d.associateCount)} />
              <Stat label="Parte c/u" value={formatCents(d.shareCents)} />
              <Stat label="Arrastre" value={formatCents(d.remainderCents)} />
            </Card>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
