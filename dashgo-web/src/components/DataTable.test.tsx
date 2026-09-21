import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { renderWithProviders } from '../test/test-utils'
import { DataTable } from './DataTable'

interface Row {
  id: string
  name: string
  distanceMiles: number | null
}

const columns: ColumnDef<Row, unknown>[] = [
  { header: 'Nombre', accessorKey: 'name' },
  {
    header: 'Distancia',
    id: 'distance',
    accessorFn: (row) => row.distanceMiles ?? Number.POSITIVE_INFINITY,
    cell: ({ row }) =>
      row.original.distanceMiles == null ? '—' : `${row.original.distanceMiles} mi`,
  },
]

function rows(): Row[] {
  return [
    { id: 'a', name: 'Cercano', distanceMiles: 1.2 },
    { id: 'b', name: 'Sin distancia', distanceMiles: null },
    { id: 'c', name: 'Lejano', distanceMiles: 8.5 },
  ]
}

function namesInOrder() {
  return screen
    .getAllByText(/Cercano|Sin distancia|Lejano/)
    .map((el) => el.textContent)
}

describe('DataTable — Distancia column sorting', () => {
  it('the Distancia header is sortable (has an accessorFn, not just id+cell)', () => {
    renderWithProviders(
      <DataTable data={rows()} columns={columns} emptyMessage="Sin datos" />,
    )
    const header = screen.getByText('Distancia')
    // Sortable headers get the pointer/select-none styling class from DataTable.
    expect(header.closest('th')).toHaveClass('cursor-pointer')
  })

  // This table's default toggle order for a numeric column is desc → asc:
  // the first click already proves nulls sort with the real values (not
  // shoved to a fixed spot) — Infinity is the correct "biggest" value first.
  it('sorts descending by distance on the first click (nulls/no-distance first)', async () => {
    renderWithProviders(
      <DataTable data={rows()} columns={columns} emptyMessage="Sin datos" />,
    )

    await userEvent.click(screen.getByText('Distancia'))

    expect(namesInOrder()).toEqual(['Sin distancia', 'Lejano', 'Cercano'])
  })

  it('sorts ascending with nulls last on the second click', async () => {
    renderWithProviders(
      <DataTable data={rows()} columns={columns} emptyMessage="Sin datos" />,
    )

    await userEvent.click(screen.getByText('Distancia'))
    await userEvent.click(screen.getByText(/Distancia/))

    expect(namesInOrder()).toEqual(['Cercano', 'Lejano', 'Sin distancia'])
  })

  it('supports controlled sorting via sorting/onSortingChange props', async () => {
    function Controlled() {
      const [sorting, setSorting] = useState<SortingState>([])
      return (
        <>
          <button onClick={() => setSorting([])}>Cercanía</button>
          <DataTable
            data={rows()}
            columns={columns}
            emptyMessage="Sin datos"
            sorting={sorting}
            onSortingChange={setSorting}
          />
        </>
      )
    }
    renderWithProviders(<Controlled />)

    // API order (unsorted) initially.
    expect(namesInOrder()).toEqual(['Cercano', 'Sin distancia', 'Lejano'])

    await userEvent.click(screen.getByText('Distancia'))
    expect(namesInOrder()).toEqual(['Sin distancia', 'Lejano', 'Cercano'])

    // The reset control clears `sorting` back to [] — API order again.
    await userEvent.click(screen.getByRole('button', { name: 'Cercanía' }))
    expect(namesInOrder()).toEqual(['Cercano', 'Sin distancia', 'Lejano'])
  })
})
