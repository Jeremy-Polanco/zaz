import { useEffect } from 'react'
import { createFileRoute, useParams, useRouter } from '@tanstack/react-router'
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
import {
  useDeleteAddress,
  useMyAddresses,
  useSetDefaultAddress,
  useUpdateAddress,
} from '../lib/queries'
import { savedAddressSchema, type SavedAddressInput } from '../lib/schemas'

export const Route = createFileRoute('/direcciones/$id')({
  component: EditAddressPage,
})

function serverMessage(err: unknown, fallback: string) {
  return (
    (err as Error & { response?: { data?: { message?: string } } })?.response
      ?.data?.message ?? fallback
  )
}

function EditAddressPage() {
  const { id } = useParams({ from: '/direcciones/$id' })
  const router = useRouter()
  const { data: addresses, isPending } = useMyAddresses()
  const updateAddress = useUpdateAddress()
  const setDefault = useSetDefaultAddress()
  const deleteAddress = useDeleteAddress()

  const address = addresses?.find((a) => a.id === id)

  const form = useForm<SavedAddressInput>({
    resolver: zodResolver(savedAddressSchema),
    defaultValues: {
      label: '',
      line1: '',
      line2: '',
      lat: 0,
      lng: 0,
      instructions: '',
    },
  })

  // Hydrate the form once the address is loaded.
  const { reset } = form
  useEffect(() => {
    if (address) {
      reset({
        label: address.label,
        line1: address.line1,
        line2: address.line2 ?? '',
        lat: address.lat,
        lng: address.lng,
        instructions: address.instructions ?? '',
      })
    }
  }, [address, reset])

  const lat = form.watch('lat')
  const lng = form.watch('lng')

  if (isPending) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando dirección…</span>
      </div>
    )
  }

  if (!address) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-20 text-center">
        <span className="eyebrow">Dirección no encontrada</span>
        <p className="mt-3 text-ink-muted">
          <button
            type="button"
            onClick={() => router.navigate({ to: '/direcciones' })}
            className="underline"
          >
            Volver a mis direcciones
          </button>
        </p>
      </div>
    )
  }

  const onSubmit = form.handleSubmit(async (values) => {
    await updateAddress.mutateAsync({
      id,
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

  const onSetDefault = async () => {
    await setDefault.mutateAsync(id)
  }

  const onDelete = async () => {
    if (
      !window.confirm(
        `¿Estás seguro de que quieres eliminar "${address.label}"?`,
      )
    ) {
      return
    }
    await deleteAddress.mutateAsync(id)
    router.navigate({ to: '/direcciones' })
  }

  return (
    <div className="page-rise mx-auto max-w-2xl px-6 py-12">
      <SectionHeading
        eyebrow="Mis direcciones"
        title={
          <>
            Editar <span className="italic text-brand">dirección.</span>
          </>
        }
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={onSetDefault}
            disabled={address.isDefault || setDefault.isPending}
          >
            {address.isDefault ? 'Es la principal' : 'Hacer principal'}
          </Button>
        }
      />

      <form onSubmit={onSubmit} className="flex flex-col gap-6">
        <div>
          <Label htmlFor="label">Nombre</Label>
          <Input id="label" {...form.register('label')} />
          <FieldError message={form.formState.errors.label?.message} />
        </div>

        <div>
          <Label htmlFor="line1">Dirección</Label>
          <Input id="line1" {...form.register('line1')} />
          <FieldError message={form.formState.errors.line1?.message} />
        </div>

        <div>
          <Label htmlFor="line2">Apto / Piso (opcional)</Label>
          <Input id="line2" {...form.register('line2')} />
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
          <Textarea id="instructions" {...form.register('instructions')} />
          <FieldError message={form.formState.errors.instructions?.message} />
        </div>

        {updateAddress.isError && (
          <p className="border-l-2 border-bad pl-3 text-sm font-medium text-bad">
            {serverMessage(updateAddress.error, 'No pudimos guardar los cambios')}
          </p>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" size="lg" disabled={updateAddress.isPending}>
            {updateAddress.isPending ? 'Guardando…' : 'Guardar cambios'}
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

      <div className="mt-10 border-t border-ink/10 pt-6">
        <button
          type="button"
          onClick={onDelete}
          disabled={deleteAddress.isPending}
          className="text-sm font-medium text-bad underline underline-offset-4 hover:opacity-80 disabled:opacity-50"
        >
          {deleteAddress.isPending ? 'Eliminando…' : 'Eliminar dirección'}
        </button>
        {deleteAddress.isError && (
          <p className="mt-2 text-sm font-medium text-bad">
            {serverMessage(deleteAddress.error, 'No pudimos eliminar la dirección')}
          </p>
        )}
      </div>
    </div>
  )
}
