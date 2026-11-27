/**
 * Agenda de eventos ao vivo (doc 08 "dirigível de promoções 3×/dia"; GDD §6 "Telecomunicação"; E3.10).
 *
 * - **Dirigível:** 3 vezes por dia, no horário da cidade, passa um anúncio para todas as salas: o evento da
 *   semana (do game-core) ou um aviso da Prefeitura.
 * - **Datas marcadas:** Ano Novo, Carnaval (calculado pela Páscoa) e Natal, com um anúncio ao meio-dia.
 *   Os efeitos de jogo dessas datas (itens e bônus) ficam para o game designer; aqui é o anúncio.
 *
 * Tudo é calculado pela hora: o mesmo horário nunca sai duas vezes (cada evento tem uma chave), e um
 * processo que ficou fora não manda atrasado o que passou há mais de 5 minutos.
 *
 * PREMISSAS: horários do dirigível 10 h, 15 h e 20 h; fuso de Brasília (UTC−3, sem horário de verão);
 * os textos dos avisos.
 */
export const AIRSHIP_HOURS = [10, 15, 20] as const;
export const HOLIDAY_HOUR = 12;
export const DEFAULT_UTC_OFFSET_MIN = -180;
export const LATE_LIMIT_MS = 5 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export type EventKind = 'airship' | 'holiday';

export interface ScheduledEvent {
  /** Chave única: o mesmo evento não sai duas vezes. */
  key: string;
  kind: EventKind;
  at: Date;
  title: string;
  /** Texto fixo (datas marcadas); o do dirigível é montado na hora. */
  text?: string;
}

/** Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher), em UTC à meia-noite. */
export function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Terça de Carnaval: 47 dias antes da Páscoa. */
export const carnival = (year: number) => new Date(easter(year).getTime() - 47 * DAY);

const HOLIDAYS = (year: number) => [
  { id: 'ano-novo', date: new Date(Date.UTC(year, 0, 1)), title: '🎆 Ano Novo', text: 'Feliz Ano Novo, Smart Chain City! Um ano de bons turnos e bons negócios.' },
  {
    id: 'carnaval',
    date: carnival(year),
    title: '🎭 Carnaval',
    text: 'É Carnaval na cidade! Encontre os amigos no bairro e aproveite a folia.',
  },
  { id: 'natal', date: new Date(Date.UTC(year, 11, 25)), title: '🎄 Natal', text: 'Feliz Natal! A Prefeitura deseja boas festas a todos os moradores.' },
];

/** Instante em UTC de uma hora local (no fuso `offsetMin`) no dia local de `dayUtc`. */
const localAt = (dayUtc: Date, hour: number, offsetMin: number) =>
  new Date(Date.UTC(dayUtc.getUTCFullYear(), dayUtc.getUTCMonth(), dayUtc.getUTCDate(), hour) - offsetMin * 60_000);

/** O dia local (00:00 UTC do mesmo dia do calendário) de um instante. */
const localDay = (at: Date, offsetMin: number) => {
  const shifted = new Date(at.getTime() + offsetMin * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
};

/** Eventos da agenda entre `from` (inclusive) e `to` (exclusive), em ordem. */
export function eventsBetween(from: Date, to: Date, offsetMin = DEFAULT_UTC_OFFSET_MIN): ScheduledEvent[] {
  const out: ScheduledEvent[] = [];
  for (let day = localDay(from, offsetMin); localAt(day, 0, offsetMin) < to; day = new Date(day.getTime() + DAY)) {
    const iso = day.toISOString().slice(0, 10);
    for (const h of AIRSHIP_HOURS) {
      out.push({ key: `airship:${iso}:${h}`, kind: 'airship', at: localAt(day, h, offsetMin), title: '🎈 Dirigível da Prefeitura' });
    }
    for (const hol of HOLIDAYS(day.getUTCFullYear())) {
      if (hol.date.getTime() === day.getTime()) {
        out.push({ key: `holiday:${hol.id}:${day.getUTCFullYear()}`, kind: 'holiday', at: localAt(day, HOLIDAY_HOUR, offsetMin), title: hol.title, text: hol.text });
      }
    }
  }
  return out.filter((e) => e.at >= from && e.at < to).sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** Os que venceram desde a última passada (sem os atrasados demais), para mandar agora. */
export function dueEvents(lastRun: Date, now: Date, sent: ReadonlySet<string>, offsetMin = DEFAULT_UTC_OFFSET_MIN): ScheduledEvent[] {
  const from = new Date(Math.max(lastRun.getTime(), now.getTime() - LATE_LIMIT_MS));
  return eventsBetween(from, new Date(now.getTime() + 1), offsetMin).filter((e) => !sent.has(e.key));
}

/** Texto do dirigível: o evento da semana, quando o game-core responde; senão, um aviso da Prefeitura. */
export interface WeeklyEvent {
  label: string;
  factor: number;
  ends_at?: string;
}

const NOTICES = [
  'Mantenha a moradia em dia: sem casa regular, aluguel ou hotel, o turno rende metade.',
  'A loja do jogo tem roupas que aumentam o ganho do turno para sempre.',
  'Regularize o seu imóvel na Prefeitura e ligue água e energia: assim ele rende 100%.',
];

export function airshipText(weekly: WeeklyEvent | null, at: Date): string {
  if (weekly) {
    const pct = Math.round((weekly.factor - 1) * 100);
    return `${weekly.label}: as profissões da semana ganham +${pct}% no turno.`;
  }
  return NOTICES[Math.floor(at.getTime() / HOUR) % NOTICES.length]!;
}
