export function SuscriptorBadge({ wasSubscriber }: { wasSubscriber: boolean }) {
  if (!wasSubscriber) return null
  return (
    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[0.65rem] font-medium uppercase tracking-wide text-green-700">
      Suscriptor
    </span>
  )
}
