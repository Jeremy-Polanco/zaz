import { createFileRoute, isRedirect, redirect } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { Button, FieldError, Input, Label, SectionHeading } from '../components/ui'
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
  useUploadCategoryImage,
  type CreateCategoryInput,
} from '../lib/queries'
import type { AuthUser, Category } from '../lib/types'
import { TOKEN_KEY, api } from '../lib/api'

export const Route = createFileRoute('/super/categories')({
  beforeLoad: async () => {
    if (!localStorage.getItem(TOKEN_KEY)) throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    try {
      const { data: me } = await api.get<AuthUser>('/auth/me')
      if (me.role !== 'super_admin_delivery') throw redirect({ to: '/' })
    } catch (e) {
      if (isRedirect(e)) throw e
      throw redirect({ to: '/login', search: { next: undefined, ref: undefined } })
    }
  },
  component: SuperCategoriesPage,
})

type FormState = {
  name: string
  slug: string
  iconEmoji: string
  displayOrder: string
  errors: { name?: string; displayOrder?: string }
}

const emptyForm: FormState = {
  name: '',
  slug: '',
  iconEmoji: '',
  displayOrder: '0',
  errors: {},
}

function CategoryForm({
  editing,
  onDone,
}: {
  editing: Category | null
  onDone: () => void
}) {
  const create = useCreateCategory()
  const update = useUpdateCategory()
  const [state, setState] = useState<FormState>(() =>
    editing
      ? {
          name: editing.name,
          slug: editing.slug,
          iconEmoji: editing.iconEmoji ?? '',
          displayOrder: String(editing.displayOrder),
          errors: {},
        }
      : emptyForm,
  )
  const pending = create.isPending || update.isPending

  const onSubmit = async () => {
    const errors: FormState['errors'] = {}
    if (state.name.trim().length < 2) errors.name = 'Mínimo 2 caracteres'
    const order = parseInt(state.displayOrder, 10)
    if (!Number.isFinite(order) || order < 0) errors.displayOrder = '0 o más'
    if (Object.keys(errors).length > 0) {
      setState((s) => ({ ...s, errors }))
      return
    }
    const payload: CreateCategoryInput = {
      name: state.name.trim(),
      slug: state.slug.trim() || undefined,
      iconEmoji: state.iconEmoji.trim() || undefined,
      displayOrder: order,
    }
    try {
      if (editing) {
        await update.mutateAsync({ id: editing.id, ...payload })
      } else {
        await create.mutateAsync(payload)
      }
      onDone()
    } catch (e) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo guardar'
      alert(msg)
    }
  }

  return (
    <div className="mb-10 border border-ink/15 bg-paper p-6">
      <div className="mb-5 flex items-center justify-between">
        <span className="eyebrow">
          {editing ? 'Editar categoría' : 'Nueva categoría'}
        </span>
        <Button size="sm" variant="ghost" onClick={onDone} disabled={pending}>
          Cancelar
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div>
          <Label htmlFor="catName">Nombre</Label>
          <Input
            id="catName"
            value={state.name}
            onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
            placeholder="Agua"
          />
          <FieldError message={state.errors.name} />
        </div>

        <div>
          <Label htmlFor="catSlug">Slug (opcional)</Label>
          <Input
            id="catSlug"
            value={state.slug}
            onChange={(e) => setState((s) => ({ ...s, slug: e.target.value }))}
            placeholder="agua"
          />
        </div>

        <div>
          <Label htmlFor="catEmoji">Emoji</Label>
          <Input
            id="catEmoji"
            maxLength={4}
            value={state.iconEmoji}
            onChange={(e) =>
              setState((s) => ({ ...s, iconEmoji: e.target.value }))
            }
            placeholder="💧"
          />
        </div>

        <div>
          <Label htmlFor="catOrder">Orden</Label>
          <Input
            id="catOrder"
            type="number"
            min="0"
            value={state.displayOrder}
            onChange={(e) =>
              setState((s) => ({ ...s, displayOrder: e.target.value }))
            }
          />
          <FieldError message={state.errors.displayOrder} />
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <Button variant="accent" onClick={onSubmit} disabled={pending}>
          {pending ? 'Guardando…' : editing ? 'Guardar' : 'Crear categoría'}
        </Button>
      </div>
    </div>
  )
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024

function CategoryImageUpload({ categoryId }: { categoryId: string }) {
  const upload = useUploadCategoryImage(categoryId)

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      alert('La imagen no puede superar 5 MB')
      e.target.value = ''
      return
    }
    upload.mutate(file, {
      onSuccess: () => {
        alert('Imagen actualizada')
        e.target.value = ''
      },
      onError: (err) => {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response?.data
            ?.message ?? 'No se pudo subir la imagen'
        alert(msg)
        e.target.value = ''
      },
    })
  }

  return (
    <label
      className={`flex cursor-pointer items-center gap-1 border border-ink/15 bg-paper-deep/40 px-2 py-1 text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted hover:border-ink/30 hover:text-ink ${
        upload.isPending ? 'pointer-events-none opacity-50' : ''
      }`}
      title="Subir imagen"
    >
      {upload.isPending ? 'Subiendo…' : '📷 Imagen'}
      <input
        type="file"
        accept="image/*"
        className="sr-only"
        disabled={upload.isPending}
        onChange={onChange}
      />
    </label>
  )
}

function SuperCategoriesPage() {
  const { data: categories, isPending } = useCategories()
  const del = useDeleteCategory()
  const update = useUpdateCategory()
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)

  const onDelete = (c: Category) => {
    if (!window.confirm(`¿Borrar "${c.name}"?`)) return
    del.mutate(c.id)
  }

  // Render order is the source of truth — sort by displayOrder, with createdAt
  // as a stable tiebreaker so duplicates from legacy data don't flicker.
  const sorted = useMemo(() => {
    return [...(categories ?? [])].sort((a, b) => {
      const order = a.displayOrder - b.displayOrder
      if (order !== 0) return order
      return (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    })
  }, [categories])

  const moveCategory = async (c: Category, delta: number) => {
    const idx = sorted.findIndex((x) => x.id === c.id)
    if (idx < 0) return
    const targetIdx = idx + delta
    if (targetIdx < 0 || targetIdx >= sorted.length) return
    const neighbor = sorted[targetIdx]

    // If legacy data has duplicate orders, a pure swap would be a no-op.
    // In that case, give the moved item a unique slot by stepping past the neighbor.
    if (c.displayOrder === neighbor.displayOrder) {
      const stepped = c.displayOrder + delta
      try {
        await update.mutateAsync({
          id: c.id,
          displayOrder: Math.max(0, stepped),
        })
      } catch (err) {
        const msg =
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message ?? 'No se pudo reordenar'
        alert(msg)
      }
      return
    }

    try {
      await Promise.all([
        update.mutateAsync({ id: c.id, displayOrder: neighbor.displayOrder }),
        update.mutateAsync({ id: neighbor.id, displayOrder: c.displayOrder }),
      ])
    } catch (err) {
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? 'No se pudo reordenar'
      alert(msg)
    }
  }

  if (isPending) {
    return (
      <div className="mx-auto max-w-6xl px-6 py-20 text-center">
        <span className="eyebrow">Cargando…</span>
      </div>
    )
  }

  const editingOrCreating = editing !== null || creating

  return (
    <div className="page-rise mx-auto max-w-4xl px-6 py-12">
      <SectionHeading
        eyebrow="Panel · Categorías"
        title={
          <>
            Organizá tu <span className="italic text-brand">catálogo.</span>
          </>
        }
        subtitle={`${categories?.length ?? 0} categoría${categories?.length === 1 ? '' : 's'} definida${categories?.length === 1 ? '' : 's'}.`}
        action={
          !editingOrCreating ? (
            <Button variant="accent" onClick={() => setCreating(true)}>
              + Nueva categoría
            </Button>
          ) : undefined
        }
      />

      {editingOrCreating ? (
        <CategoryForm
          editing={editing}
          onDone={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {sorted.map((c, i) => {
          const isFirst = i === 0
          const isLast = i === sorted.length - 1
          return (
            <div
              key={c.id}
              className="flex items-center gap-4 border border-ink/15 bg-paper px-5 py-4"
            >
              <span className="flex h-10 w-10 items-center justify-center border border-ink/10 bg-paper-deep/40 text-xl">
                {c.iconEmoji ?? '·'}
              </span>
              <div className="flex-1">
                <p className="display text-lg font-semibold text-ink">
                  {c.name}
                </p>
                <p className="text-[0.7rem] uppercase tracking-[0.14em] text-ink-muted">
                  /{c.slug} · orden {c.displayOrder}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isFirst || update.isPending}
                  onClick={() => moveCategory(c, -1)}
                  aria-label="Subir"
                >
                  ↑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={isLast || update.isPending}
                  onClick={() => moveCategory(c, +1)}
                  aria-label="Bajar"
                >
                  ↓
                </Button>
                <CategoryImageUpload categoryId={c.id} />
                <Button size="sm" variant="primary" onClick={() => setEditing(c)}>
                  Editar
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(c)}>
                  Borrar
                </Button>
              </div>
            </div>
          )
        })}

        {(categories ?? []).length === 0 && !editingOrCreating ? (
          <div className="flex flex-col items-center gap-4 border border-dashed border-ink/20 py-20 text-center">
            <span className="eyebrow">Sin categorías</span>
            <p className="display text-2xl text-ink-muted">
              Creá la primera categoría.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  )
}
