// Linhas de candidato (g1 + Polymarket): foto, nome, partido, votos; % grande, variação recente, barra fina.
// Referências opcionais (1º turno, 2022) aparecem como marcas na barra e uma linha de comparação.
import type { Board, CandidateDef, CurvePoint, Snap } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { useMemo } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { fmtInt, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Fill } from '@/components/core/bars';

const PCT2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const WINDOW_MS = 5 * 60_000;

/** variação de A (em pontos) nos últimos ~5 minutos de atualizações do TSE */
export function recentDelta(curve: CurvePoint[]): number | null {
  if (curve.length < 2) return null;
  const last = curve[curve.length - 1];
  const t = last.at ? Date.parse(last.at) : NaN;
  if (!Number.isFinite(t)) return last.pa - curve[curve.length - 2].pa;
  let ref = curve[0];
  for (const p of curve) {
    if (p.at && Date.parse(p.at) <= t - WINDOW_MS) ref = p;
    else break;
  }
  return ref === last ? null : last.pa - ref.pa;
}

/** variação em tom neutro: vermelho/verde confundiria com as cores dos candidatos */
function Arrowed({ v, digits = 2, suffix }: { v: number; digits?: number; suffix?: string }) {
  const up = v > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="num inline-flex items-center gap-0.5">
      <Icon className={cn('size-3.5', up ? 'text-foreground' : 'text-muted-foreground')} aria-hidden />
      <span className="sr-only">{up ? 'mais' : 'menos'}</span>
      <span className={up ? 'text-foreground' : undefined}>{fmtPct(Math.abs(v), digits)}</span>
      {suffix && <span className="ml-0.5">{suffix}</span>}
    </span>
  );
}

function Trend({ v }: { v: number | null }) {
  if (v === null) return <span className="text-[11px] text-muted-foreground">&nbsp;</span>;
  if (Math.abs(v) < 0.005) return <span className="num text-[11px] text-muted-foreground">estável em 5 min</span>;
  return (
    <span className="text-[11px] font-medium text-muted-foreground">
      <Arrowed v={v} suffix="em 5 min" />
    </span>
  );
}

export interface RowRefs {
  /** % de A no confronto A×B do 1º turno 2026 */
  t1?: number | null;
  /** % de A (lado de A) no 2º turno de 2022 */
  y22?: number | null;
}

const REF_LABEL: Record<keyof RowRefs, string> = { t1: '1º turno', y22: '2022' };
/** 1º turno: tique cheio; 2022: tique vazado — distinguíveis sem depender de cor */
export const REF_TICK: Record<keyof RowRefs, string> = {
  t1: 'bg-foreground ring-2 ring-background',
  y22: 'bg-background ring-[1.5px] ring-foreground',
};

export function RefTick({ k, className }: { k: keyof RowRefs; className?: string }) {
  return <span className={cn('inline-block h-3 w-[3px] rounded-full', REF_TICK[k], className)} aria-hidden />;
}

function Row({
  c,
  pct,
  votes,
  lead,
  delta,
  final,
  refs,
  reserve = false,
  counted = true,
}: {
  c: CandidateDef;
  pct: number;
  votes: number;
  lead: boolean;
  delta: number | null;
  final: boolean;
  reserve?: boolean;
  /** já há voto apurado (antes das 17h não) */
  counted?: boolean;
  /** referências já convertidas para este candidato (0–100) */
  refs: { k: keyof RowRefs; v: number }[];
}) {
  return (
    <li className="py-3.5 first:pt-1">
      <div className="flex items-center gap-3">
        <CandidateAvatar c={c} size="md" ring={lead} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{c.short}</span>
            {lead && (
              <span className="shrink-0 text-[11px] font-semibold" style={{ color: c.color }}>
                {final ? 'Maioria' : 'À frente'}
              </span>
            )}
          </div>
          {/* votos em linha própria: com 8 dígitos não cabem ao lado do status em 360px */}
          <div className="num mt-0.5 truncate text-[12px] text-muted-foreground">
            {c.party ? `${c.party} · ` : ''}
            {fmtInt(votes)} votos
          </div>
        </div>
        <div className="text-right">
          <div className="display text-[28px] leading-none font-semibold">
            <NumberFlow value={pct} format={PCT2} locales="pt-BR" suffix="%" />
          </div>
          <div className="mt-1 flex justify-end">
            <Trend v={delta} />
          </div>
        </div>
      </div>
      <div className="relative mt-3 h-1.5 rounded-full bg-muted" aria-hidden>
        <div className="absolute inset-0 overflow-hidden rounded-full">
          <Fill pct={pct} className="rounded-full" style={{ background: c.color }} />
        </div>
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/35" />
        {refs.map((r) => (
          <span
            key={r.k}
            className={cn('absolute -top-1 h-3.5 w-[3px] -translate-x-1/2 rounded-full', REF_TICK[r.k])}
            style={{ left: `${Math.max(0, Math.min(100, r.v))}%` }}
          />
        ))}
      </div>
      {(refs.length > 0 || reserve) && (
        // reserve: altura fixa mesmo vazia, para ligar/desligar referências não empurrar a página
        <dl className={cn('mt-2 flex gap-x-4 text-[12px] text-muted-foreground', reserve ? 'h-5 flex-nowrap items-center overflow-hidden' : 'flex-wrap gap-y-1')}>
          {refs.map((r) => (
            <div key={r.k} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap">
              <dt className="flex items-center gap-1.5">
                <RefTick k={r.k} />
                {REF_LABEL[r.k]}
              </dt>
              <dd className="num flex items-center gap-1.5">
                <span className="font-medium text-foreground">{fmtPct(r.v, 1)}%</span>
                {/* sem voto apurado ainda, a distância para a referência não quer dizer nada */}
                {counted && <Arrowed v={pct - r.v} digits={1} suffix="pts" />}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  );
}

export function CandidateRows({
  board,
  snap,
  className,
  refs,
  reserve = false,
}: {
  board: Board;
  snap: Snap;
  className?: string;
  /** referências opcionais (% de A); ausentes = não mostra */
  refs?: RowRefs;
  /** reserva a linha de referência mesmo sem nenhuma ligada (filtros sem deslocar a tela) */
  reserve?: boolean;
}) {
  const [ca, cb] = board.candidates;
  const d = useMemo(() => (snap.s === 'br' ? recentDelta(board.curve) : null), [board.curve, snap.s]);
  const final = snap.status === 'totalizado';
  const refsFor = (side: 'a' | 'b') =>
    (Object.entries(refs ?? {}) as [keyof RowRefs, number | null | undefined][])
      .filter((e): e is [keyof RowRefs, number] => typeof e[1] === 'number')
      .map(([k, v]) => ({ k, v: side === 'a' ? v : 100 - v }));
  // líder primeiro, como num placar
  const rows = [
    { c: ca, pct: snap.pa, votes: snap.a, lead: snap.lead === 'a', delta: d, refs: refsFor('a') },
    { c: cb, pct: snap.pb, votes: snap.b, lead: snap.lead === 'b', delta: d === null ? null : -d, refs: refsFor('b') },
  ].sort((x, y) => y.pct - x.pct);
  return (
    <ul className={cn('divide-y', className)} aria-label="Votos por candidato">
      {rows.map((r) => (
        <Row key={r.c.key} {...r} final={final} reserve={reserve} counted={snap.valid > 0} />
      ))}
    </ul>
  );
}
