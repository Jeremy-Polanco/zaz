import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'
import { cn } from '../lib/utils'

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'accent'
  size?: 'sm' | 'md' | 'lg'
}) {
  const variants = {
    primary:
      'bg-ink text-paper border border-ink hover:bg-ink-soft hover:-translate-y-px',
    accent:
      'bg-accent text-brand-dark border border-accent hover:bg-accent-dark hover:-translate-y-px',
    secondary:
      'bg-paper text-ink border border-ink/80 hover:bg-paper-deep hover:-translate-y-px',
    ghost:
      'bg-transparent text-ink border border-transparent hover:bg-ink/5',
    danger:
      'bg-bad text-paper border border-bad hover:opacity-90 hover:-translate-y-px',
  }
  const sizes = {
    sm: 'h-8 px-3 text-[0.78rem]',
    md: 'h-11 px-5 text-sm',
    lg: 'h-14 px-8 text-base',
  }
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xs font-medium uppercase tracking-[0.08em] transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:translate-y-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  )
}

export function Input({
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-11 w-full rounded-xs border-0 border-b border-ink/30 bg-transparent px-1 text-base font-medium text-ink placeholder:text-ink-muted/60 focus:border-ink focus:outline-none transition-colors',
        className,
      )}
      {...props}
    />
  )
}

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-24 w-full rounded-xs border-0 border-b border-ink/30 bg-transparent px-1 py-2 text-base text-ink placeholder:text-ink-muted/60 focus:border-ink focus:outline-none transition-colors resize-y',
        className,
      )}
      {...props}
    />
  )
}

export function Select({
  className,
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-xs border-0 border-b border-ink/30 bg-transparent px-1 text-base font-medium text-ink focus:border-ink focus:outline-none transition-colors appearance-none',
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 12 12%22 fill=%22none%22><path d=%22M3 5l3 3 3-3%22 stroke=%22%231a1a1a%22 stroke-width=%221.5%22 stroke-linecap=%22round%22/></svg>')] bg-no-repeat bg-[right_0.25rem_center] pr-6",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  )
}

export function Label({
  children,
  htmlFor,
}: {
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="eyebrow mb-2 block"
    >
      {children}
    </label>
  )
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-2 text-xs font-medium text-bad">
      <span className="mr-1">—</span>
      {message}
    </p>
  )
}

export function Card({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'rounded-sm border border-ink/10 bg-paper p-6 shadow-paper',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  action,
  className,
}: {
  eyebrow?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-8 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="flex flex-col gap-2">
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1 className="display text-4xl font-semibold leading-[1.05] text-ink sm:text-5xl">
          {title}
        </h1>
        {subtitle && (
          <p className="max-w-xl text-base text-ink-muted">{subtitle}</p>
        )}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

// ─── ZAZ brand mark + bolt (no react-native-svg needed for web) ───

export function BoltIcon({
  size = 14,
  color = "#F5E447",
  className = "",
}: {
  size?: number
  color?: string
  className?: string
}) {
  return (
    <svg
      width={size}
      height={Math.round(size * 1.4)}
      viewBox="0 0 14 20"
      fill={color}
      className={className}
      aria-hidden="true"
    >
      <path d="M9 0 L1 11 L7 11 L5 20 L13 8 L7 8 L9 0 Z" />
    </svg>
  )
}

export function ZazMark({ size = 26 }: { size?: number }) {
  // Wordmark: white Z + yellow lightning bolt + white Z, on transparent bg.
  // Renders as a single inline SVG so it scales crisp at any size.
  const w = size * 2.6
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 96 36"
      fill="none"
      aria-label="ZAZ"
    >
      <path d="M2 4 H22 L6 30 H22" stroke="currentColor" strokeWidth="5" strokeLinejoin="miter" fill="none" />
      <path d="M48 0 L36 20 L46 20 L42 36 L60 14 L50 14 L54 0 Z" fill="#F5E447" />
      <path d="M70 4 H90 L74 30 H90" stroke="currentColor" strokeWidth="5" strokeLinejoin="miter" fill="none" />
    </svg>
  )
}

