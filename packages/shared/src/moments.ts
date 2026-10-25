// Momentos: eventos gerados a partir do diff entre dois ciclos do poller.
// IDs são determinísticos (kind + escopo + marco) para o poller poder reiniciar sem duplicar.
import { fmtPct } from './calc';
import type { CandidateDef, Moment, Snap } from './types';
import { ufName } from './ufs';

export const MILESTONES = [10, 25, 50, 75, 90, 95, 99];
const UF_MILESTONES = [50, 100];

export interface MomentInput {
  cands: CandidateDef[];
  prevBr: Snap | null;
  br: Snap;
  prevUfs: Record<string, Snap>;
  ufs: Record<string, Snap>;
  prevMun?: Record<string, Snap>;
  mun?: Record<string, Snap>;
  /** info de municípios por IBGE (nome, UF, eleitorado) */
  munInfo?: Record<string, { name: string; uf: string; el: number }>;
  /** lado vencedor em 2022 por IBGE */
  lead2022?: Record<string, 'a' | 'b' | null>;
  /** eleitorado mínimo para um município gerar momento */
  bigMunEl?: number;
  now?: string;
}

const crossed = (prev: number, now: number, mark: number) => prev < mark && now >= mark;
/** maior marco cruzado neste ciclo: um salto grande (o exterior chegando de uma vez) vira um marco só */
const topCrossed = (marks: number[], prev: number, now: number) => marks.filter((m) => crossed(prev, now, m)).pop();
/** o título nunca diz menos do que já está apurado: "passa de 50% (57,6%)" quando o salto foi além do marco */
const overshot = (mark: number, pst: number) => fmtPct(pst, 1) !== fmtPct(mark, 1);

export function detectMoments(i: MomentInput): Moment[] {
  const out: Moment[] = [];
  const at = i.now ?? new Date().toISOString();
  const nameOf = (side: 'a' | 'b') => i.cands.find((c) => c.key === side)!.short;
  const lineOf = (s: Snap) =>
    `${i.cands[0].short} ${fmtPct(s.pa, 1)}% × ${fmtPct(s.pb, 1)}% ${i.cands[1].short}`;
  const push = (m: Omit<Moment, 'at'>) => out.push({ ...m, at });

  const brMark = topCrossed(MILESTONES, i.prevBr?.pst ?? 0, i.br.pst);
  if (brMark !== undefined) {
    push({
      id: `milestone:br:${brMark}`,
      kind: 'milestone',
      scope: 'br',
      title: overshot(brMark, i.br.pst)
        ? `🔔 Brasil passa de ${brMark}% das urnas apuradas (${fmtPct(i.br.pst, 1)}%): ${lineOf(i.br)}`
        : `🔔 Brasil, ${brMark}% das urnas apuradas: ${lineOf(i.br)}`,
      payload: { mark: brMark, pst: i.br.pst, pa: i.br.pa, pb: i.br.pb },
    });
  }
  if (i.prevBr?.lead && i.br.lead && i.prevBr.lead !== i.br.lead) {
    push({
      id: `virada:br:${i.br.lead}:${Math.floor(i.br.pst)}`,
      kind: 'virada',
      scope: 'br',
      title: `⚡ Virada! ${nameOf(i.br.lead)} passa à frente com ${fmtPct(i.br.pst, 1)}% apurado`,
      payload: { lead: i.br.lead, pst: i.br.pst },
    });
  }
  if (i.prevBr && i.prevBr.status !== 'definido' && i.br.status === 'definido') {
    push({
      id: 'definido:br',
      kind: 'definido',
      scope: 'br',
      title: `🧮 Matematicamente definido: os votos que faltam não permitem virada (${fmtPct(i.br.pst, 1)}% apurado)`,
      payload: { lead: i.br.lead },
    });
  }
  if (i.prevBr && i.prevBr.status !== 'totalizado' && i.br.status === 'totalizado') {
    push({
      id: 'totalizado:br',
      kind: 'totalizado',
      scope: 'br',
      title: `✅ TSE concluiu a totalização: ${lineOf(i.br)}`,
      payload: { pa: i.br.pa, pb: i.br.pb },
    });
  }

  for (const [key, s] of Object.entries(i.ufs)) {
    const p = i.prevUfs[key];
    if (!p) continue;
    const uf = key.slice(3);
    const mark = topCrossed(UF_MILESTONES, p.pst, s.pst);
    if (mark !== undefined) {
      push({
        id: `uf_milestone:${uf}:${mark}`,
        kind: 'uf_milestone',
        scope: key,
        title: overshot(mark, s.pst)
          ? `🔔 ${ufName(uf)} passa de ${mark}% apurado (${fmtPct(s.pst, 1)}%): ${lineOf(s)}`
          : `🔔 ${ufName(uf)}, ${mark}% apurado: ${lineOf(s)}`,
        payload: { mark, pst: s.pst, pa: s.pa },
      });
    }
    // só depois de 5% apurado: antes disso é ruído
    if (p.lead && s.lead && p.lead !== s.lead && s.pst >= 5) {
      push({
        id: `virada_uf:${uf}:${s.lead}:${Math.floor(s.pst)}`,
        kind: 'virada_uf',
        scope: key,
        title: `⚡ ${ufName(uf)} virou: ${nameOf(s.lead)} passa à frente (${fmtPct(s.pst, 1)}% apurado)`,
        payload: { lead: s.lead, pst: s.pst },
      });
    }
  }

  const minEl = i.bigMunEl ?? 300_000;
  for (const [key, s] of Object.entries(i.mun ?? {})) {
    const ibge = key.replace(/^mun:/, '');
    const info = i.munInfo?.[ibge];
    if (!info || info.el < minEl) continue;
    const p = i.prevMun?.[key];
    if (p && p.pst < 100 && s.pst >= 100 && s.lead) {
      push({
        id: `mun_final:${ibge}`,
        kind: 'mun_final',
        scope: key,
        title: `🏁 ${info.name} (${info.uf}) 100% apurada: ${lineOf(s)}`,
        payload: { pa: s.pa, ibge },
      });
      const before = i.lead2022?.[ibge];
      if (before && before !== s.lead) {
        push({
          id: `mun_flip:${ibge}`,
          kind: 'mun_flip',
          scope: key,
          title: `🔄 ${info.name} virou: em 2022 deu ${nameOf(before)}, agora ${nameOf(s.lead)}`,
          payload: { from: before, to: s.lead, ibge },
        });
      }
    }
  }
  return out;
}
