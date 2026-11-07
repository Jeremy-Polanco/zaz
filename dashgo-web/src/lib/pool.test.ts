import { describe, it, expect } from 'vitest'
import { formatDistributionDate, quarterLabel } from './pool'

describe('quarterLabel', () => {
  it('convierte la clave del trimestre en texto legible', () => {
    expect(quarterLabel('2026-Q4')).toBe('4.º trimestre 2026')
    expect(quarterLabel('2027-Q1')).toBe('1.º trimestre 2027')
  })

  it('devuelve la clave tal cual si no tiene el formato esperado', () => {
    expect(quarterLabel('raro')).toBe('raro')
  })
})

describe('formatDistributionDate', () => {
  it('formatea en hora de Nueva York: 05:00Z del 1 de enero sigue siendo 1 de enero', () => {
    expect(formatDistributionDate('2027-01-01T05:00:00.000Z')).toBe('1 de enero de 2027')
  })

  it('no corre el día cuando el instante cae antes de medianoche en NY', () => {
    // 03:00Z = 22:00 del día anterior en Nueva York (invierno).
    expect(formatDistributionDate('2027-01-01T03:00:00.000Z')).toBe('31 de diciembre de 2026')
  })
})
