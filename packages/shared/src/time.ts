// Horários oficiais. Brasília = UTC−3 (sem horário de verão desde 2019).
export const ELECTION_DAY = '2026-10-25';
/** placar e projeções só aparecem a partir daqui; palpites fecham aqui */
export const DEFAULT_RELEASE_AT = '2026-10-25T19:00:00-03:00';

export const releaseAt = (env?: string) => new Date(env || DEFAULT_RELEASE_AT);
export const isReleased = (now: Date = new Date(), at: Date = releaseAt()) => now.getTime() >= at.getTime();

export function fmtBrt(iso: string | Date, opts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' }) {
  return new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...opts });
}
