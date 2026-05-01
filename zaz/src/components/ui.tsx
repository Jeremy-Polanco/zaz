import { View, Text, Pressable, ActivityIndicator, type PressableProps, type ViewProps, type TextProps } from 'react-native'
import { SymbolView } from 'expo-symbols'
import type { ReactNode } from 'react'
import type { OrderStatus } from '../lib/types'
import { statusLabel } from '../lib/format'

export function Eyebrow({ children, className = '', tone = 'muted' }: { children: ReactNode; className?: string; tone?: 'muted' | 'accent' | 'ink' }) {
  const color = tone === 'accent' ? 'text-brand' : tone === 'ink' ? 'text-ink' : 'text-ink-muted'
  return (
    <Text className={`font-sans text-[11px] uppercase tracking-eyebrow ${color} ${className}`}>
      {children}
    </Text>
  )
}

export function Display({ children, className = '', italic = false }: { children: ReactNode; className?: string; italic?: boolean }) {
  const fam = italic ? 'font-sans-italic' : 'font-sans-semibold'
  return <Text className={`${fam} text-ink ${className}`}>{children}</Text>
}

export function Hairline({ className = '' }: { className?: string }) {
  return <View className={`h-[1px] bg-ink/15 ${className}`} />
}

type ButtonProps = PressableProps & {
  variant?: 'ink' | 'accent' | 'ghost' | 'outline'
  size?: 'md' | 'lg'
  loading?: boolean
  children: ReactNode
}

export function Button({
  variant = 'ink',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...rest
}: ButtonProps & { className?: string }) {
  const base = 'flex-row items-center justify-center rounded-xs'
  const height = size === 'lg' ? 'h-14' : 'h-12'
  const px = size === 'lg' ? 'px-6' : 'px-5'
  const variants: Record<string, { bg: string; text: string; pressed: string }> = {
    ink: { bg: 'bg-ink', text: 'text-paper', pressed: 'active:bg-ink-soft' },
    accent: { bg: 'bg-accent', text: 'text-brand-dark', pressed: 'active:bg-accent-dark' },
    ghost: { bg: 'bg-transparent', text: 'text-ink', pressed: 'active:bg-ink/5' },
    outline: { bg: 'bg-paper border border-ink/20', text: 'text-ink', pressed: 'active:bg-paper-deep' },
  }
  const v = variants[variant]
  const loaderColor =
    variant === 'ink' ? '#FAFAFC' : variant === 'accent' ? '#15012E' : '#1A1530'
  return (
    <Pressable
      disabled={disabled || loading}
      className={`${base} ${height} ${px} ${v.bg} ${v.pressed} ${disabled || loading ? 'opacity-60' : ''} ${className}`}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={loaderColor} />
      ) : (
        <Text className={`font-sans-medium text-[12px] uppercase tracking-label ${v.text}`}>
          {children}
        </Text>
      )}
    </Pressable>
  )
}

const STATUS_STYLE: Record<OrderStatus, { border: string; bg: string; text: string; dot: string }> = {
  pending_quote: { border: 'border-warn/40', bg: 'bg-warn/10', text: 'text-warn', dot: 'bg-warn' },
  quoted: { border: 'border-accent/50', bg: 'bg-accent/10', text: 'text-accent-dark', dot: 'bg-accent' },
  pending_validation: { border: 'border-warn/40', bg: 'bg-warn/10', text: 'text-warn', dot: 'bg-warn' },
  confirmed_by_colmado: { border: 'border-brand/40', bg: 'bg-brand/10', text: 'text-brand-dark', dot: 'bg-brand' },
  in_delivery_route: { border: 'border-accent/50', bg: 'bg-accent/10', text: 'text-accent-dark', dot: 'bg-accent' },
  delivered: { border: 'border-ok/40', bg: 'bg-ok/10', text: 'text-ok', dot: 'bg-ok' },
  cancelled: { border: 'border-bad/40', bg: 'bg-bad/10', text: 'text-bad', dot: 'bg-bad' },
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS_STYLE[status]
  return (
    <View className={`flex-row items-center gap-1.5 border px-2 py-1 ${s.border} ${s.bg}`}>
      <View className={`h-[6px] w-[6px] rounded-full ${s.dot}`} />
      <Text className={`font-sans text-[10px] uppercase tracking-label ${s.text}`}>
        {statusLabel(status)}
      </Text>
    </View>
  )
}

export function SectionHead({ eyebrow, title, italicTail, subtitle }: {
  eyebrow?: string
  title: string
  italicTail?: string
  subtitle?: string
}) {
  return (
    <View className="mb-8">
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      <View className="flex-row flex-wrap items-baseline">
        <Display className="text-4xl leading-[40px]">{title}</Display>
        {italicTail && (
          <Display italic className="text-4xl leading-[40px] text-brand"> {italicTail}</Display>
        )}
      </View>
      {subtitle && (
        <Text className="mt-3 text-[15px] leading-[22px] text-ink-soft">{subtitle}</Text>
      )}
    </View>
  )
}

export function Metric({ label, value, accent = false }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <View className="flex-1 border border-ink/15 bg-paper p-4">
      <Eyebrow>{label}</Eyebrow>
      <Text className={`mt-1 font-sans-semibold text-3xl ${accent ? 'text-brand' : 'text-ink'}`}>
        {value}
      </Text>
    </View>
  )
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-2 font-sans text-[11px] uppercase tracking-eyebrow text-ink-muted">
      {children}
    </Text>
  )
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <Text className="mt-1.5 font-sans text-[11px] uppercase tracking-label text-bad">
      {message}
    </Text>
  )
}

export function Card({ children, className = '', ...rest }: ViewProps & { className?: string; children: ReactNode }) {
  return (
    <View className={`border border-ink/15 bg-paper p-5 ${className}`} {...rest}>
      {children}
    </View>
  )
}

export function Nums({ children, className = '', ...rest }: TextProps & { className?: string; children: ReactNode }) {
  return (
    <Text style={{ fontVariant: ['tabular-nums'] }} className={`text-ink ${className}`} {...rest}>
      {children}
    </Text>
  )
}

// ─── ZAZ design system: Brand mark, bolt, status stepper, speed banner ───

export function BoltIcon({
  size = 14,
  color = '#F5E447',
}: {
  size?: number
  color?: string
}) {
  return (
    <SymbolView
      name={{ ios: 'bolt.fill', android: 'bolt' }}
      size={size}
      tintColor={color}
      resizeMode="scaleAspectFit"
      fallback={<Text style={{ fontSize: size, color }}>⚡</Text>}
    />
  )
}

export function ZazMark({
  size = 26,
  letterColor = '#FAFAFC',
}: {
  size?: number
  letterColor?: string
}) {
  // Wordmark rendered as: Z  ⚡  Z, where the bolt replaces the central "A".
  // Inter Tight Bold matches the SVG mark in the design system closely.
  const letterStyle = {
    fontSize: size,
    fontWeight: '700' as const,
    color: letterColor,
    letterSpacing: -1,
    lineHeight: size * 1.05,
  }
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 1 }}>
      <Text style={letterStyle}>Z</Text>
      <BoltIcon size={size * 0.85} color="#F5E447" />
      <Text style={letterStyle}>Z</Text>
    </View>
  )
}

const STEPPER_ORDER: OrderStatus[] = [
  'pending_quote',
  'quoted',
  'pending_validation',
  'confirmed_by_colmado',
  'in_delivery_route',
  'delivered',
]
const STEPPER_SHORT: Record<OrderStatus, string> = {
  pending_quote: 'Cotizar',
  quoted: 'Cotizado',
  pending_validation: 'Validar',
  confirmed_by_colmado: 'Confirmado',
  in_delivery_route: 'En ruta',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

export function StatusStepper({ status }: { status: OrderStatus }) {
  const idx = STEPPER_ORDER.indexOf(status)
  return (
    <View className="flex-row items-start gap-1">
      {STEPPER_ORDER.map((s, i) => {
        const done = i < idx
        const active = i === idx
        const dim = !done && !active
        return (
          <View
            key={s}
            className={`flex-1 ${dim ? 'opacity-40' : ''}`}
          >
            <View
              className={`h-[3px] ${done || active ? 'bg-brand' : 'bg-ink/15'}`}
            />
            <Text
              className={`mt-1.5 font-sans-medium text-[9px] uppercase tracking-label ${active ? 'text-brand' : 'text-ink-muted'}`}
              numberOfLines={1}
            >
              {STEPPER_SHORT[s]}
            </Text>
          </View>
        )
      })}
    </View>
  )
}

export function SpeedBanner({
  estimate,
  zone,
}: {
  estimate: string
  zone: string
}) {
  return (
    <View className="flex-row items-center gap-3 bg-brand px-4 py-3">
      <BoltIcon size={14} color="#F5E447" />
      <View className="flex-1">
        <Text
          className="font-sans-medium text-[9px] uppercase tracking-label"
          style={{ color: 'rgba(245,228,71,0.9)' }}
        >
          Entrega estimada
        </Text>
        <Text className="font-sans-medium text-[14px] text-paper">
          {estimate} · {zone}
        </Text>
      </View>
    </View>
  )
}

/**
 * KpiCard — small bordered card with colored dot + label + tabnum value.
 * Used in admin dashboards (Ruta, Crédito, Promotores).
 *
 * `tone` controls the dot color:
 *  - 'attn' (default): brand purple, pulses when value > 0 — active/needs-attention
 *  - 'warn': accent-dark mustard, pulses — pending/in-flight
 *  - 'ok': ok green — done
 *  - 'idle': muted gray, no pulse — informational
 */
export function KpiCard({
  label,
  value,
  tone = 'attn',
}: {
  label: string
  value: string | number
  tone?: 'attn' | 'warn' | 'ok' | 'idle'
}) {
  const numeric = typeof value === 'number' ? value : Number(value)
  const isActive = !Number.isNaN(numeric) && numeric > 0
  const pulse = isActive && (tone === 'attn' || tone === 'warn')
  const dotColor =
    tone === 'ok'
      ? 'bg-ok'
      : tone === 'warn'
        ? 'bg-accent-dark'
        : tone === 'idle'
          ? 'bg-ink-muted'
          : 'bg-brand'
  return (
    <View className="flex-1 border border-ink/15 bg-paper px-3 py-2.5">
      <View className="flex-row items-center gap-1.5">
        <View
          className={`h-1.5 w-1.5 rounded-full ${dotColor}`}
          style={pulse ? { opacity: 0.85 } : undefined}
        />
        <Text className="font-sans-medium text-[10px] uppercase tracking-label text-ink-muted">
          {label}
        </Text>
      </View>
      <Text
        className="mt-1 font-sans-semibold text-[24px] tracking-tight text-ink"
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
    </View>
  )
}

/**
 * BreakdownRow — single line in a money breakdown (subtotal, tax, points...).
 * Mirrors the design system's resumen pattern.
 *
 * `emphasis`:
 *  - 'normal' (default): ink text — neutral line
 *  - 'muted': ink-muted — for "A cotizar" / "A calcular" placeholders
 *  - 'positive': ok green — for negative amounts (discounts, points, credit)
 */
export function BreakdownRow({
  label,
  value,
  emphasis = 'normal',
  italic = false,
}: {
  label: string
  value: string
  emphasis?: 'normal' | 'muted' | 'positive'
  italic?: boolean
}) {
  const tone =
    emphasis === 'muted'
      ? 'text-ink-muted'
      : emphasis === 'positive'
        ? 'text-ok'
        : 'text-ink'
  return (
    <View className="flex-row items-center justify-between py-2">
      <Text className="font-sans text-[13px] text-ink-soft">{label}</Text>
      <Text
        className={`font-sans-medium text-[14px] ${tone} ${italic ? 'italic' : ''}`}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {value}
      </Text>
    </View>
  )
}

export function PlaceholderImage({
  label,
  size = 80,
  fontSize,
}: {
  label: string
  size?: number
  fontSize?: number
}) {
  return (
    <View
      className="items-center justify-center border border-ink/15"
      style={{
        width: size,
        height: size,
        // Striped diagonal pattern, matches design-system .placeholder-img
        experimental_backgroundImage:
          'repeating-linear-gradient(135deg, #F0F0F5, #F0F0F5 6px, rgba(26, 21, 48, 0.06) 6px, rgba(26, 21, 48, 0.06) 12px)',
      }}
    >
      <Text
        className="font-sans-semibold uppercase tracking-label text-ink-muted"
        style={{
          fontSize: fontSize ?? Math.max(8, Math.round(size * 0.12)),
          fontFamily: 'ui-monospace',
        }}
      >
        {label}
      </Text>
    </View>
  )
}
