import { nextDistributionAt, nextQuarter, quarterOf, quarterStart } from './quarter';

describe('quarter helpers', () => {
  it('usa la hora de NY, no la del servidor', () => {
    expect(quarterOf(new Date('2027-01-01T04:59:00Z'))).toBe('2026-Q4'); // 23:59 NY
    expect(quarterOf(new Date('2027-01-01T05:00:00Z'))).toBe('2027-Q1'); // 00:00 NY
    expect(quarterOf(new Date('2026-07-01T03:59:00Z'))).toBe('2026-Q2'); // EDT
    expect(quarterOf(new Date('2026-07-01T04:00:00Z'))).toBe('2026-Q3');
  });
  it('avanza de trimestre y de año', () => {
    expect(nextQuarter('2026-Q4')).toBe('2027-Q1');
    expect(nextQuarter('2027-Q1')).toBe('2027-Q2');
  });
  it('calcula el inicio del trimestre con el offset correcto (EST/EDT)', () => {
    expect(quarterStart('2027-Q1').toISOString()).toBe('2027-01-01T05:00:00.000Z');
    expect(quarterStart('2027-Q2').toISOString()).toBe('2027-04-01T04:00:00.000Z');
    expect(nextDistributionAt(new Date('2026-11-06T15:00:00Z')).toISOString())
      .toBe('2027-01-01T05:00:00.000Z');
  });
});
