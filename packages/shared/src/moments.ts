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

export function detectMoments(i: MomentInput): Moment[] {
  const out: Moment[] = [];
  const at = i.now ?? new Date().toISOString();
  const nameOf = (side: 'a' | 'b') => i.cands.find((c) => c.key === side)!.short;
  const lineOf = (s: Snap) =>
    `${i.cands[0].short} ${fmtPct(s.pa, 1)}% × ${fmtPct(s.pb, 1)}% ${i.cands[1].short}`;
  const push = (m: Omit<Moment, 'at'>) => out.push({ ...m, at });

  const prevPst = i.prevBr?.pst ?? 0;
  for (const mark of MILESTONES) {
    if (crossed(prevPst, i.br.pst, mark)) {
      push({
        id: `milestone:br:${mark}`,
        kind: 'milestone',
        scope: 'br',
        title: `🔔 Brasil, ${mark}% das urnas apuradas: ${lineOf(i.br)}`,
        payload: { mark, pa: i.br.pa, pb: i.br.pb },
      });
    }
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
    for (const mark of UF_MILESTONES) {
      if (crossed(p.pst, s.pst, mark)) {
        push({
          id: `uf_milestone:${uf}:${mark}`,
          kind: 'uf_milestone',
          scope: key,
          title: `🔔 ${ufName(uf)}, ${mark}% apurado: ${lineOf(s)}`,
          payload: { mark, pa: s.pa },
        });
      }
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
