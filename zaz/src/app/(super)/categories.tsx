import { useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '../../lib/queries'
import type { Category } from '../../lib/types'
import {
  Button,
  Card,
  Eyebrow,
  FieldError,
  FieldLabel,
  Hairline,
  KpiCard,
  Metric,
  SectionHead,
} from '../../components/ui'

type FormState = {
  name: string
  slug: string
  iconEmoji: string
  displayOrderText: string
  errors: { name?: string; slug?: string; displayOrderText?: string }
}

const emptyForm: FormState = {
  name: '',
  slug: '',
  iconEmoji: '',
  displayOrderText: '0',
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
          displayOrderText: String(editing.displayOrder ?? 0),
          errors: {},
        }
      : emptyForm,
  )
  const pending = create.isPending || update.isPending

  const onSubmit = async () => {
    const errors: FormState['errors'] = {}
    if (state.name.trim().length < 2) errors.name = 'Mínimo 2 caracteres'
    if (state.slug.trim() !== '' && !/^[a-z0-9-]+$/.test(state.slug.trim()))
      errors.slug = 'kebab-case (a-z, 0-9, -)'
    const order =
      state.displayOrderText.trim() === ''
        ? 0
        : parseInt(state.displayOrderText, 10)
    if (!Number.isFinite(order) || order < 0)
      errors.displayOrderText = 'Orden inválido'
    if (Object.keys(errors).length > 0) {
      setState((s) => ({ ...s, errors }))
      return
    }

    const payload = {
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
      Alert.alert('Error', msg)
    }
  }

  return (
    <Card className="mb-8">
      <Eyebrow className="mb-4" tone="accent">
        {editing ? 'Editar' : 'Nueva'}
      </Eyebrow>
      <Text className="mb-6 font-sans-semibold text-[26px] leading-[30px] text-ink">
        {editing ? editing.name : 'Nueva categoría'}
      </Text>

      <FieldLabel>Nombre</FieldLabel>
      <TextInput
        className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
        placeholder="Agua"
        placeholderTextColor="#6B6488"
        value={state.name}
        onChangeText={(v) => setState((s) => ({ ...s, name: v }))}
      />
      <FieldError message={state.errors.name} />

      <View className="mt-5 flex-row gap-4">
        <View className="flex-1">
          <FieldLabel>Slug (opcional)</FieldLabel>
          <TextInput
            className="h-11 border-b border-ink/25 pb-1 font-sans text-[15px] text-ink"
            placeholder="se genera del nombre"
            placeholderTextColor="#6B6488"
            autoCapitalize="none"
            value={state.slug}
            onChangeText={(v) => setState((s) => ({ ...s, slug: v }))}
          />
          <FieldError message={state.errors.slug} />
        </View>
        <View className="w-24">
          <FieldLabel>Emoji</FieldLabel>
          <TextInput
            className="h-11 border-b border-ink/25 pb-1 text-center text-[22px]"
            placeholder="💧"
            placeholderTextColor="#6B6488"
            maxLength={4}
            value={state.iconEmoji}
            onChangeText={(v) => setState((s) => ({ ...s, iconEmoji: v }))}
          />
        </View>
      </View>

      <View className="mt-5">
        <FieldLabel>Orden</FieldLabel>
        <TextInput
          className="h-11 border-b border-ink/25 pb-1 font-sans text-[16px] text-ink"
          placeholder="0"
          placeholderTextColor="#6B6488"
          keyboardType="number-pad"
          value={state.displayOrderText}
          onChangeText={(v) =>
            setState((s) => ({ ...s, displayOrderText: v }))
          }
        />
        <FieldError message={state.errors.displayOrderText} />
      </View>

      <View className="mt-6 flex-row gap-3">
        <View className="flex-1">
          <Button variant="accent" loading={pending} onPress={onSubmit}>
            {editing ? 'Guardar' : 'Crear'}
          </Button>
        </View>
        <Button variant="ghost" onPress={onDone} disabled={pending}>
          Cancelar
        </Button>
      </View>
    </Card>
  )
}

function CategoryRow({
  category,
  onEdit,
  onDelete,
  onMove,
  moving,
}: {
  category: Category
  onEdit: () => void
  onDelete: () => void
  onMove: (delta: -1 | 1) => void
  moving: boolean
}) {
  return (
    <View className="py-4">
      <View className="mb-3 flex-row items-center justify-between">
        <View className="flex-1 flex-row items-center gap-3 pr-3">
          <Text className="font-sans-semibold text-[28px]">
            {category.iconEmoji ?? '📦'}
          </Text>
          <View className="flex-1">
            <Text className="font-sans-semibold text-[20px] leading-[24px] text-ink">
              {category.name}
            </Text>
            <Text
              className="mt-0.5 font-sans text-[10px] uppercase tracking-label text-ink-muted"
              style={{ fontVariant: ['tabular-nums'] }}
            >
              {category.slug} · orden {category.displayOrder}
            </Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <Pressable
            onPress={() => onMove(-1)}
            disabled={moving}
            className="h-9 w-9 items-center justify-center border border-ink/20 bg-paper active:bg-paper-deep"
          >
            <Text className="font-sans-semibold text-lg text-ink">↑</Text>
          </Pressable>
          <Pressable
            onPress={() => onMove(1)}
            disabled={moving}
            className="h-9 w-9 items-center justify-center border border-ink/20 bg-paper active:bg-paper-deep"
          >
            <Text className="font-sans-semibold text-lg text-ink">↓</Text>
          </Pressable>
        </View>
      </View>

      <View className="flex-row gap-2">
        <View className="flex-1">
          <Button variant="outline" onPress={onEdit}>
            Editar
          </Button>
        </View>
        <Button variant="ghost" onPress={onDelete}>
          Borrar
        </Button>
      </View>

      <Hairline className="mt-5" />
    </View>
  )
}

export default function SuperCategoriesScreen() {
  const {
    data: categories,
    isPending,
    refetch,
    isRefetching,
  } = useCategories()
  const update = useUpdateCategory()
  const del = useDeleteCategory()
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)

  const count = useMemo(() => categories?.length ?? 0, [categories])

  const handleDelete = (category: Category) => {
    Alert.alert(
      'Borrar categoría',
      `¿Borrar "${category.name}"? Los productos que la usan quedarán sin categoría.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Borrar',
          style: 'destructive',
          onPress: () => del.mutate(category.id),
        },
      ],
    )
  }

  const handleMove = (category: Category, delta: -1 | 1) => {
    const next = Math.max(0, category.displayOrder + delta)
    if (next === category.displayOrder) return
    update.mutate({ id: category.id, displayOrder: next })
  }

  if (isPending) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper">
        <ActivityIndicator color="#220247" size="small" />
      </SafeAreaView>
    )
  }

  const editingOrCreating = editing !== null || creating

  return (
    <SafeAreaView edges={['top']} className="flex-1 bg-paper">
      <FlatList
        data={editingOrCreating ? [] : categories ?? []}
        keyExtractor={(c) => c.id}
        contentContainerClassName="px-5 pb-12"
        refreshing={isRefetching}
        onRefresh={refetch}
        ListHeaderComponent={
          <View className="pb-2 pt-6">
            <SectionHead
              eyebrow="Panel · Categorías"
              title="Categorías"
              italicTail="y orden."
              subtitle="Agrupá el catálogo para filtrar más rápido."
            />

            <View className="mb-7 flex-row gap-2">
              <KpiCard label="Categorías" value={count} tone="idle" />
            </View>

            {editingOrCreating ? (
              <CategoryForm
                editing={editing}
                onDone={() => {
                  setEditing(null)
                  setCreating(false)
                }}
              />
            ) : (
              <View className="mb-6">
                <Button variant="accent" onPress={() => setCreating(true)}>
                  + Nueva categoría
                </Button>
              </View>
            )}

            {!editingOrCreating && <Hairline className="mb-2" />}
          </View>
        }
        renderItem={({ item }) => (
          <CategoryRow
            category={item}
            onEdit={() => {
              setEditing(item)
              setCreating(false)
            }}
            onDelete={() => handleDelete(item)}
            onMove={(delta) => handleMove(item, delta)}
            moving={update.isPending}
          />
        )}
        ListEmptyComponent={
          !editingOrCreating ? (
            <View className="items-center py-16">
              <Eyebrow>Sin categorías</Eyebrow>
              <Text className="mt-3 text-center text-[15px] text-ink-soft">
                Creá la primera para organizar el catálogo.
              </Text>
            </View>
          ) : null
        }
      />
    </SafeAreaView>
  )
}
