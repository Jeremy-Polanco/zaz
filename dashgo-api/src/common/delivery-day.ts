/**
 * Formatea el día de reparto ('YYYY-MM-DD') para leerlo en español:
 * '2026-09-16' → 'miércoles 16 de septiembre'.
 *
 * OJO — la razón de existir de este helper: `new Date('2026-09-16')` NO sirve.
 * El runtime parsea esa forma como medianoche UTC, y en America/New_York
 * (UTC-4/-5, donde está el negocio) eso cae a las 20:00 del día ANTERIOR: al
 * cliente le llegaría "martes 15" para una entrega del miércoles 16. Por eso se
 * arma con los componentes sueltos, `new Date(y, m - 1, d)`, que construye la
 * fecha en hora LOCAL y no mueve nada.
 *
 * La columna es `date` a propósito (ver orders.scheduled_delivery_date): es un
 * DÍA de reparto, no un instante, así que nunca hay que meterle zona horaria.
 */
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function formatDeliveryDay(isoDay: string): string {
  const parts = ISO_DAY.exec(isoDay);
  // Ante un valor raro se devuelve el crudo: esto alimenta notificaciones y una
  // notificación no puede tirar excepciones por un dato inesperado.
  if (!parts) return isoDay;

  const [, year, month, day] = parts;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  return date
    .toLocaleDateString('es', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })
    // Intl devuelve "miércoles, 16 de septiembre"; la única coma es la que
    // separa el día de la semana y sobra dentro de la frase del push.
    .replace(',', '');
}
