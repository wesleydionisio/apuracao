// Projeção como intervalo (nunca número seco), sempre com "estimativa" e % apurado.
import type { Board, CandidateDef, Projection, Side } from '@apuracao/shared';
import { ChevronDown, TrendingUp } from 'lucide-react';
import { CandidateAvatar } from '@/components/core/candidate';
import { Estimate } from '@/components/ui';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from './Section';

/** quem a faixa aponta como à frente: o poller confirma em ciclos seguidos (`lead`); projeção antiga sem o campo, pela faixa */
function leaderOf(p: Projection): Side | null {
  if (p.lead !== undefined) return p.lead;
  return p.lo > 50 ? 'a' : p.hi < 50 ? 'b' : null;
}

/** eixo adaptado à faixa (sempre contendo 50%), para a faixa não virar um risco */
function axisFor(lo: number, hi: number) {
  const span = Math.max(8, Math.abs(lo - 50) + 3, Math.abs(hi - 50) + 3);
  return [Math.max(0, Math.round(50 - span)), Math.min(100, Math.round(50 + span))] as const;
}

/** barra da faixa: fundo dividido em 50% (à direita A vence, à esquerda B), faixa na cor de A e marca no centro */
export function RangeBar({ lo, hi, cands, compact, label }: { lo: number; hi: number; cands: CandidateDef[]; compact?: boolean; label: string }) {
  const [ca, cb] = cands;
  const l = Math.max(0, Math.min(lo, 100));
  const h = Math.max(0, Math.min(hi, 100));
  const [A, B] = axisFor(l, h);
  const x = (v: number) => Math.max(0, Math.min(100, ((v - A) / (B - A)) * 100));
  return (
    <>
      <div className={cn('relative', compact ? 'h-6' : 'h-9')} role="img" aria-label={label}>
        <div className={cn('absolute inset-x-0 flex overflow-hidden rounded-full', compact ? 'top-2 h-2' : 'top-3 h-3')}>
          <div className="h-full" style={{ width: `${x(50)}%`, background: `color-mix(in oklab, ${cb.color} 22%, transparent)` }} />
          <div className="h-full flex-1" style={{ background: `color-mix(in oklab, ${ca.color} 22%, transparent)` }} />
        </div>
        <div
          className={cn('absolute rounded-full border-2 border-card', compact ? 'top-1 h-4' : 'top-1.5 h-6')}
          style={{ left: `${x(l)}%`, width: `${Math.max(2, x(h) - x(l))}%`, background: ca.color }}
        />
        <div className={cn('absolute w-[3px] -translate-x-1/2 rounded-full bg-card', compact ? 'top-0.5 h-5' : 'top-0.5 h-8')} style={{ left: `${x((l + h) / 2)}%` }} />
        <div className={cn('absolute top-0 w-px bg-foreground/70', compact ? 'h-6' : 'h-9')} style={{ left: `${x(50)}%` }} />
      </div>
      <div className={cn('num flex justify-between text-muted-foreground', compact ? 'mt-0.5 text-[10px]' : 'mt-1 text-[11px]')}>
        <span>{A}%</span>
        <span className="font-medium text-foreground">50%</span>
        <span>{B}%</span>
      </div>
    </>
  );
}

export function ProjectionBand({ board, className }: { board: Board; className?: string }) {
  const p = board.projection;
  if (!board.flags.projection || !p) return null;
  const [ca, cb] = board.candidates;
  const lo = Math.max(0, Math.min(p.lo, 100));
  const hi = Math.max(0, Math.min(p.hi, 100));
  const lead = leaderOf(p);
  const winner = lead ? board.candidates.find((c) => c.key === lead)! : null;
  return (
    <Section icon={TrendingUp} title="Para onde vai" meta={<Estimate pst={p.basedOnPst} />} className={className}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[12px] text-muted-foreground">{ca.short}</div>
          <div className="display mt-1 text-[24px] leading-none font-semibold">
            {fmtPct(lo, 1)}% a {fmtPct(hi, 1)}%
          </div>
        </div>
        {winner ? (
          <div className="flex items-center gap-2 text-right">
            <div className="text-[12px] leading-tight text-muted-foreground">
              à frente
              <div className="text-[13px] font-semibold" style={{ color: winner.color }}>
                {winner.short}
              </div>
            </div>
            <CandidateAvatar c={winner} size="sm" />
          </div>
        ) : (
          <div className="text-right text-[12px] font-medium text-muted-foreground">indefinido</div>
        )}
      </div>
      <div className="mt-4">
        <RangeBar lo={lo} hi={hi} cands={board.candidates} label={`Intervalo estimado para ${ca.short}: ${fmtPct(lo, 1)}% a ${fmtPct(hi, 1)}%`} />
      </div>
      <p className="num mt-2 text-[12px] text-muted-foreground">
        {cb.short}: {fmtPct(100 - hi, 1)}% a {fmtPct(100 - lo, 1)}%
      </p>
      {p.curve && p.curve.length >= 3 && <Trail board={board} p={p} />}
      <HowItWorks model={p.model} />
    </Section>
  );
}

/** faixa da projeção ao longo da noite (x = % apurado) com o parcial por baixo: mostra para onde o parcial estava indo */
function Trail({ board, p }: { board: Board; p: Projection }) {
  const ca = board.candidates[0];
  const pts = p.curve!;
  const x0 = pts[0].pst;
  const partial = board.curve.filter((c) => c.pst >= x0);
  const vals = [...pts.flatMap((q) => [q.lo, q.hi]), ...partial.map((c) => c.pa), 50];
  const pad = 0.4;
  const y0 = Math.min(...vals) - pad;
  const y1 = Math.max(...vals) + pad;
  const W = 320;
  const H = 96;
  const x1 = Math.max(x0 + 5, pts[pts.length - 1].pst, partial[partial.length - 1]?.pst ?? 0);
  const X = (v: number) => ((v - x0) / (x1 - x0)) * W;
  const Y = (v: number) => H - ((v - y0) / Math.max(0.5, y1 - y0)) * H;
  const band = `M${pts.map((q) => `${X(q.pst).toFixed(1)},${Y(q.hi).toFixed(1)}`).join('L')}L${[...pts]
    .reverse()
    .map((q) => `${X(q.pst).toFixed(1)},${Y(q.lo).toFixed(1)}`)
    .join('L')}Z`;
  const line = (xs: { pst: number; v: number }[]) => `M${xs.map((q) => `${X(q.pst).toFixed(1)},${Y(q.v).toFixed(1)}`).join('L')}`;
  const first = pts[0];
  const last = pts[pts.length - 1];
  return (
    <figure className="relative mt-4">
      <span className="num pointer-events-none absolute right-0 -translate-y-full pb-0.5 text-[10px] text-muted-foreground" style={{ top: `${(Y(50) / H) * 96}px` }} aria-hidden>
        50%
      </span>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-24 w-full overflow-visible"
        role="img"
        aria-label={`A projeção para ${ca.short} começou em ${fmtPct(first.pa, 1)}% com ${fmtPct(first.pst, 0)}% apurado e está em ${fmtPct(last.pa, 1)}%; o parcial está em ${fmtPct(board.br?.pa ?? last.pa, 1)}%.`}
      >
        <line x1={0} x2={W} y1={Y(50)} y2={Y(50)} className="stroke-foreground/30" vectorEffect="non-scaling-stroke" />
        <path d={band} fill={`color-mix(in oklab, ${ca.color} 20%, transparent)`} />
        <path d={line(pts.map((q) => ({ pst: q.pst, v: q.pa })))} fill="none" stroke={ca.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        {partial.length > 1 && (
          <path d={line(partial.map((c) => ({ pst: c.pst, v: c.pa })))} fill="none" className="stroke-foreground/70" strokeWidth={1.5} strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
        )}
      </svg>
      <figcaption className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm" style={{ background: `color-mix(in oklab, ${ca.color} 35%, transparent)` }} aria-hidden />
          projeção de {ca.short} (faixa de 95%)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 border-t-[1.5px] border-dashed border-foreground/70" aria-hidden />
          parcial de {ca.short}
        </span>
        <span className="num">
          {fmtPct(x0, 0)}% → {fmtPct(x1, 0)}% apurado
        </span>
      </figcaption>
    </figure>
  );
}

function HowItWorks({ model }: { model?: Projection['model'] }) {
  return (
    <details className="group mt-3 text-[12px] leading-relaxed text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1 font-medium text-foreground/80 select-none [&::-webkit-details-marker]:hidden">
        Como calculamos
        <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      {model === 'uf' ? (
        <p className="mt-1.5">
          Agora, pelo modelo simplificado por estado: o que falta em cada UF segue o parcial dela e o desvio em relação ao 1º turno.
          O modelo por cidade volta assim que o andamento de todas as cidades estiver completo.
        </p>
      ) : (
        <p className="mt-1.5">
          Cidade por cidade. O que falta em cada uma é estimado a partir de como ela votou no 1º turno de 2026 e no 2º turno de 2022,
          corrigido pelo desvio que as cidades já apuradas mostram (na região, no estado e na vizinhança) e pelo parcial da própria
          cidade. A faixa é de 95%: em 48 noites simuladas a partir da ordem real de chegada dos votos em 2018, 2022 e 2026, ela
          continha o resultado final em 99% das vezes.
        </p>
      )}
      <p className="mt-1.5">É uma estimativa, não resultado. Só o TSE totaliza e proclama o eleito.</p>
    </details>
  );
}

/** projeção da UF (painel do estado), quando houver */
export function UfProjection({ board, uf }: { board: Board; uf: string }) {
  const p = board.flags.projection ? board.projection?.ufs?.[uf] : undefined;
  const snap = board.ufs[`uf:${uf}`];
  if (!p || !snap) return null;
  const ca = board.candidates[0];
  return (
    <div className="mt-4 rounded-xl border p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
        <div className="flex items-center gap-1.5 text-[13px] font-medium whitespace-nowrap">
          <TrendingUp className="size-3.5 text-muted-foreground" aria-hidden />
          Projeção do estado
        </div>
        <Estimate pst={snap.pst} />
      </div>
      <div className="num mt-2 text-[13px]">
        {ca.short}: <span className="font-semibold">{fmtPct(p.lo, 1)}% a {fmtPct(p.hi, 1)}%</span>
      </div>
      <div className="mt-2">
        <RangeBar compact lo={p.lo} hi={p.hi} cands={board.candidates} label={`Intervalo estimado para ${ca.short} no estado: ${fmtPct(p.lo, 1)}% a ${fmtPct(p.hi, 1)}%`} />
      </div>
    </div>
  );
}
