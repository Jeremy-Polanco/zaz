import { createFileRoute, useRouter } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import {
  Button,
  FieldError,
  Input,
  Label,
  SectionHeading,
  Textarea,
} from '../components/ui'
import { MapPicker } from '../components/MapPicker'
import { useCreateAddress } from '../lib/queries'
import { savedAddressSchema, type SavedAddressInput } from '../lib/schemas'

export const Route = createFileRoute('/direcciones/nueva')({
  component: NewAddressPage,
})

// Washington Heights — same fallback center MapPicker uses, pre-filled so the
// visible pin already corresponds to a valid value.
const DEFAULT_CENTER = { lat: 40.8404, lng: -73.9397 }

function serverMessage(err: unknown, fallback: string) {
  return (
    (err as Error & { response?: { data?: { message?: string } } })?.response
      ?.data?.message ?? fallback
  )
}

function NewAddressPage() {
  const router = useRouter()
  const createAddress = useCreateAddress()
  const form = useForm<SavedAddressInput>({
    resolver: zodResolver(savedAddressSchema),
    defaultValues: {
      label: '',
      line1: '',
      line2: '',
      lat: DEFAULT_CENTER.lat,
      lng: DEFAULT_CENTER.lng,
      instructions: '',
    },
  })

  const lat = form.watch('lat')
  const lng = form.watch('lng')

  const onSubmit = form.handleSubmit(async (values) => {
    await createAddress.mutateAsync({
      label: values.label,
      line1: values.line1,
      line2: values.line2?.trim() ? values.line2.trim() : undefined,
      lat: values.lat,
      lng: values.lng,
      instructions: values.instructions?.trim()
        ? values.instructions.trim()
        : undefined,
    })
    router.navigate({ to: '/direcciones' })
  })

  return (
    <div className="page-rise mx-auto max-w-2xl px-6 py-12">
      <SectionHeading
        eyebrow="Mis direcciones"
        title={
          <>
            Nueva <span className="italic text-brand">dirección.</span>
          </>
        }
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div>
          <Label htmlFor="label">Nombre</Label>
          <Input
            id="label"
            placeholder="Ej: Casa, Oficina"
            {...form.register('label')}
          />
          <FieldError message={form.formState.errors.label?.message} />
        </div>

        <div>
          <Label htmlFor="line1">Dirección</Label>
          <Input
            id="line1"
            placeholder="Av. 27 de Febrero 123"
            {...form.register('line1')}
          />
          <FieldError message={form.formState.errors.line1?.message} />
        </div>

        <div>
          <Label htmlFor="line2">Apto / Piso (opcional)</Label>
          <Input
            id="line2"
            placeholder="Apto 3B, Piso 5"
            {...form.register('line2')}
          />
          <FieldError message={form.formState.errors.line2?.message} />
        </div>

        <div>
          <Label htmlFor="map">Ubicá el pin</Label>
          <MapPicker
            value={{ lat, lng }}
            onChange={({ lat: newLat, lng: newLng }) => {
              form.setValue('lat', newLat, { shouldValidate: true })
              form.setValue('lng', newLng, { shouldValidate: true })
            }}
          />
          <FieldError
            message={
              form.formState.errors.lat?.message ??
              form.formState.errors.lng?.message
            }
          />
        </div>

        <div>
          <Label htmlFor="instructions">Instrucciones (opcional)</Label>
          <Textarea
            id="instructions"
            placeholder="Toca el portón, apartamento en el fondo"
            {...form.register('instructions')}
          />
          <FieldError message={form.formState.errors.instructions?.message} />
        </div>

        {createAddress.isError && (
          <p className="border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {serverMessage(createAddress.error, 'No pudimos guardar la dirección')}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" disabled={createAddress.isPending}>
            {createAddress.isPending ? 'Guardando…' : 'Guardar dirección'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.navigate({ to: '/direcciones' })}
          >
            Cancelar
          </Button>
        </div>
      </form>
    </div>
  )
}
