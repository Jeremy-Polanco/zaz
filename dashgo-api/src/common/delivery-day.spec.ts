/**
 * El día de reparto viaja como 'YYYY-MM-DD' (una FECHA, no un instante) y se le
 * muestra al cliente en español.
 *
 * La trampa que este helper evita depende de la zona horaria: en
 * America/New_York (UTC-4/-5) la medianoche UTC cae la tarde del día anterior.
 * Para que la suite sea determinista NO se toca `process.env.TZ`: dentro del
 * sandbox de Jest esa asignación no cambia la zona real del proceso, así que el
 * test pasaba en una Mac al oeste de UTC y fallaba en el CI (que corre en UTC).
 * La demostración de la trampa fija la zona del negocio de forma explícita en
 * el propio `toLocaleDateString`, y el helper se verifica en la zona que tenga
 * la máquina — construye la fecha en hora local, así que nunca se corre.
 */
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
    const naive = new Date('2026-09-16').toLocaleDateString('es', {
      ...INTL_OPTS,
      timeZone: 'America/New_York',
    });
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
