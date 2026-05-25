import type { OrderStatus } from '../lib/types'
import { cn } from '../lib/utils'

const LABEL: Record<OrderStatus, string> = {
  pending_quote: 'Por cotizar',
  quoted: 'Cotizado',
  pending_validation: 'Pendiente',
  confirmed_by_colmado: 'Confirmado',
  in_delivery_route: 'En ruta',
  delivered: 'Entregado',
  cancelled: 'Cancelado',
}

const STYLE: Record<OrderStatus, string> = {
  pending_quote: 'border-warn/40 bg-warn/10 text-warn',
  quoted: 'border-accent/50 bg-accent/10 text-accent-dark',
  pending_validation: 'border-warn/40 bg-warn/10 text-warn',
  confirmed_by_colmado: 'border-brand/40 bg-brand/10 text-brand-dark',
  in_delivery_route: 'border-accent/50 bg-accent/10 text-accent-dark',
  delivered: 'border-ok/40 bg-ok/10 text-ok',
  cancelled: 'border-bad/40 bg-bad/10 text-bad',
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xs border px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-[0.12em]',
        STYLE[status],
      )}
    >
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'pending_quote' && 'bg-warn animate-pulse',
          status === 'quoted' && 'bg-accent animate-pulse',
          status === 'pending_validation' && 'bg-warn',
          status === 'confirmed_by_colmado' && 'bg-brand',
          status === 'in_delivery_route' && 'bg-accent animate-pulse',
          status === 'delivered' && 'bg-ok',
          status === 'cancelled' && 'bg-bad',
        )}
      />
      {LABEL[status]}
    </span>
  )
}
