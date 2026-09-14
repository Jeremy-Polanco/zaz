import { ScrollView, Pressable, Text } from 'react-native'
import { isoDayFromDate } from '../lib/format'

// Ventana de asignación: 14 días desde hoy — suficiente para planificar la
// semana y la próxima sin un selector de calendario completo.
const DAYS_AHEAD = 14

// Intl da "sept" (4 letras) en es-ES para septiembre — recortamos a 3 para
// que el chip quede parejo con el resto ("mié 17", no "mié 17" + mes largo).
function shortWeekdayAndDay(date: Date): string {
  const weekday = new Intl.DateTimeFormat('es-ES', { weekday: 'short' }).format(date)
  return `${weekday} ${date.getDate()}`
}

type DayChip = { iso: string; label: string }

function buildChips(today: Date): DayChip[] {
  return Array.from({ length: DAYS_AHEAD }, (_, i) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i)
    const iso = isoDayFromDate(d)
    const label = i === 0 ? 'Hoy' : i === 1 ? 'Mañana' : shortWeekdayAndDay(d)
    return { iso, label }
  })
}

/**
 * Fila horizontal de chips para asignar el día de entrega de una orden
 * ('YYYY-MM-DD'). Admin-only (ambos consumidores — QuoteBottomSheet y el
 * detalle de orden del super admin — son pantallas hardcoded en español),
 * así que este componente también lo está.
 *
 * No usamos un date-picker nativo a propósito: no hay dependencia de
 * calendario en package.json y el rango útil (2 semanas) entra cómodo en
 * chips scrolleables, más rápido de tocar que abrir un picker.
 */
export function DeliveryDayPicker({
  value,
  onChange,
}: {
  value: string | null
  onChange: (iso: string | null) => void
}) {
  const chips = buildChips(new Date())

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 6 }}
    >
      <Pressable
        onPress={() => onChange(null)}
        className={`px-4 py-2.5 ${
          value === null ? 'bg-ink' : 'border border-ink/15 bg-transparent'
        }`}
      >
        <Text
          className={`font-sans-medium text-[12px] uppercase tracking-label ${
            value === null ? 'text-paper' : 'text-ink-soft'
          }`}
        >
          Sin día
        </Text>
      </Pressable>
      {chips.map((chip) => {
        const selected = value === chip.iso
        return (
          <Pressable
            key={chip.iso}
            onPress={() => onChange(chip.iso)}
            className={`px-4 py-2.5 ${
              selected ? 'bg-ink' : 'border border-ink/15 bg-transparent'
            }`}
          >
            <Text
              className={`font-sans-medium text-[12px] uppercase tracking-label ${
                selected ? 'text-paper' : 'text-ink-soft'
              }`}
            >
              {chip.label}
            </Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}
