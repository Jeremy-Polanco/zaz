/**
 * El día de reparto viaja como 'YYYY-MM-DD' (una FECHA, no un instante) y se le
 * muestra al cliente en español.
 *
 * Fijamos la zona horaria REAL del negocio para que el caso "no se corre el
 * día" sea determinista: en America/New_York (UTC-4/-5) la medianoche UTC cae
 * el día anterior a la tarde, que es exactamente la trampa que este helper
 * existe para evitar. Sin esto, la misma suite pasaría en un CI en UTC y
 * taparía el bug.
 */
process.env.TZ = 'America/New_York';

import { formatDeliveryDay } from './delivery-day';

const INTL_OPTS = {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
} as const;

describe('formatDeliveryDay', () => {
  it('escribe el día en español y sin la coma que mete Intl', () => {
    // "miércoles, 16 de septiembre" es lo que devuelve Intl; la frase del push
    // se lee mejor sin la coma: "programada para el miércoles 16 de septiembre".
    expect(formatDeliveryDay('2026-09-16')).toBe('miércoles 16 de septiembre');
  });

  it('NO corre el día — new Date("YYYY-MM-DD") lo movería al anterior', () => {
    // La trampa: 'YYYY-MM-DD' se parsea como MEDIANOCHE UTC, que en
    // America/New_York son las 20:00 del día anterior. El cliente leería
    // "martes 15" para una entrega que es el miércoles 16.
    const naive = new Date('2026-09-16').toLocaleDateString('es', INTL_OPTS);
    expect(naive).toContain('15');
    expect(formatDeliveryDay('2026-09-16')).toContain('16');
  });

  it('tampoco se corre en el borde de año', () => {
    expect(formatDeliveryDay('2027-01-01')).toBe('viernes 1 de enero');
  });

  it('devuelve la cadena tal cual si no es una fecha YYYY-MM-DD', () => {
    // Una notificación jamás puede romperse por un dato raro en la columna:
    // ante la duda, se manda el texto crudo y no una excepción.
    expect(formatDeliveryDay('mañana')).toBe('mañana');
    expect(formatDeliveryDay('')).toBe('');
  });
});
