// El trimestre se mide en hora de Nueva York y no en la del servidor: el
// negocio opera en NY, así que el corte (medianoche del 1 de ene/abr/jul/oct)
// tiene que caer ahí aunque el servidor corra en UTC. Se fija `timeZone` en
// cada llamada a Intl porque `process.env.TZ` no tiene efecto dentro de Jest.
const NY_TZ = 'America/New_York';

const partsFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: NY_TZ,
  year: 'numeric',
  month: 'numeric',
});

// Devuelve 'YYYY-Qn'. El formato permite comparar trimestres como strings.
export function quarterOf(date: Date): string {
  const parts = partsFormatter.formatToParts(date);
  const year = Number(parts.find((p) => p.type === 'year')!.value);
  const month = Number(parts.find((p) => p.type === 'month')!.value);
  return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
}

function parseQuarter(quarter: string): { year: number; q: number } {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error(`Trimestre inválido: ${quarter}`);
  return { year: Number(match[1]), q: Number(match[2]) };
}

export function nextQuarter(quarter: string): string {
  const { year, q } = parseQuarter(quarter);
  return q === 4 ? `${year + 1}-Q1` : `${year}-Q${q + 1}`;
}

// Instante en que arranca el trimestre en NY. El offset (-5 EST / -4 EDT) se
// consulta a Intl para ese día en vez de hardcodearlo, así respeta el horario
// de verano: el 1 de enero es EST y el 1 de abril, julio y octubre son EDT
// (los cambios de hora caen en marzo y noviembre, nunca en un arranque).
export function quarterStart(quarter: string): Date {
  const { year, q } = parseQuarter(quarter);
  const month = (q - 1) * 3; // 0-based
  const utcMidnight = new Date(Date.UTC(year, month, 1));
  const tzName = new Intl.DateTimeFormat('en-US', {
    timeZone: NY_TZ,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(utcMidnight)
    .find((p) => p.type === 'timeZoneName')!.value; // p. ej. 'GMT-5'
  const offsetHours = Number(/GMT([+-]\d+)/.exec(tzName)![1]);
  // Medianoche NY = medianoche UTC menos el offset (offset negativo => suma horas).
  return new Date(utcMidnight.getTime() - offsetHours * 3_600_000);
}

// Próxima distribución: el arranque del trimestre siguiente al de `now`.
export function nextDistributionAt(now: Date): Date {
  return quarterStart(nextQuarter(quarterOf(now)));
}
