// Linhas de candidato (g1 + Polymarket): foto, nome, partido, votos; % grande, variação recente, barra fina.
import type { Board, CandidateDef, CurvePoint, Snap } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { useMemo } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { fmtInt } from '@/lib/format';
import { cn } from '@/lib/utils';

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

/** variação recente em tom neutro: vermelho/verde confundiria com as cores dos candidatos */
function Trend({ v }: { v: number | null }) {
  if (v === null) return <span className="text-[11px] text-muted-foreground">&nbsp;</span>;
  if (Math.abs(v) < 0.005) return <span className="num text-[11px] text-muted-foreground">estável em 5 min</span>;
  const up = v > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="num inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground">
      <Icon className={up ? 'size-3.5 text-foreground' : 'size-3.5'} aria-hidden />
      <span className="sr-only">{up ? 'subiu' : 'caiu'}</span>
      <span className={up ? 'text-foreground' : undefined}>{Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      <span>em 5 min</span>
    </span>
  );
}

function Row({
  c,
  pct,
  votes,
  lead,
  delta,
  final,
}: {
  c: CandidateDef;
  pct: number;
  votes: number;
  lead: boolean;
  delta: number | null;
  final: boolean;
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
      <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${pct}%`, background: c.color }} />
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/35" />
      </div>
    </li>
  );
}

export function CandidateRows({ board, snap, className }: { board: Board; snap: Snap; className?: string }) {
  const [ca, cb] = board.candidates;
  const d = useMemo(() => (snap.s === 'br' ? recentDelta(board.curve) : null), [board.curve, snap.s]);
  const final = snap.status === 'totalizado';
  // líder primeiro, como num placar
  const rows = [
    { c: ca, pct: snap.pa, votes: snap.a, lead: snap.lead === 'a', delta: d },
    { c: cb, pct: snap.pb, votes: snap.b, lead: snap.lead === 'b', delta: d === null ? null : -d },
  ].sort((x, y) => y.pct - x.pct);
  return (
    <ul className={cn('divide-y', className)} aria-label="Votos por candidato">
      {rows.map((r) => (
        <Row key={r.c.key} {...r} final={final} />
      ))}
    </ul>
  );
}
