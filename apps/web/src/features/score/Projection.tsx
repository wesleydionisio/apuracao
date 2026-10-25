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

/** um candidato: % projetado, faixa de 95% e o parcial de agora */
function Tile({ c, v, lo, hi, now, lead }: { c: CandidateDef; v: number | null; lo?: number; hi?: number; now: number | null; lead: boolean }) {
  return (
    <div className="min-w-0 rounded-xl border bg-card p-3" style={lead ? { borderColor: c.color } : undefined}>
      <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-semibold">
        <span className="inline-block h-0.5 w-3 shrink-0 rounded-full" style={{ background: c.color }} aria-hidden />
        <span className="truncate">{c.short}</span>
        {c.party && <span className="shrink-0 text-[12px] font-normal text-muted-foreground">{c.party}</span>}
      </div>
      <div className="display mt-2 text-[30px] leading-none font-semibold" style={v === null ? undefined : { color: c.color }}>
        {v === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            {fmtPct(v, 1)}
            <span className="text-[16px]">%</span>
          </>
        )}
      </div>
      <div className="mt-1 text-[11px] leading-tight text-muted-foreground">projeção do resultado final</div>
      <dl className="num mt-2.5 space-y-0.5 text-[12px]">
        <div className="flex justify-between gap-2">
          <dt className="whitespace-nowrap text-muted-foreground">faixa 95%</dt>
          <dd className="font-medium whitespace-nowrap">{lo === undefined || hi === undefined ? '—' : `${fmtPct(lo, 1)}–${fmtPct(hi, 1)}`}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="whitespace-nowrap text-muted-foreground">parcial agora</dt>
          <dd className="font-medium">{now === null ? '—' : `${fmtPct(now, 1)}%`}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ProjectionBand({ board, className }: { board: Board; className?: string }) {
  if (board.released && !board.flags.projection) return null;
  const p = board.projection;
  const [ca, cb] = board.candidates;
  const br = board.br;
  const now = (k: 'a' | 'b') => (br?.valid ? (k === 'a' ? br.pa : br.pb) : null);
  if (!p) {
    // antes das 17h ou com menos de 20% apurado: o cartão já montado, esperando
    const when = board.released ? 'com 20% apurado' : 'às 17h';
    return (
      <Section
        icon={TrendingUp}
        title="Para onde vai"
        meta={<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">{when}</span>}
        className={className}
      >
        <div className="grid grid-cols-2 gap-2">
          <Tile c={ca} v={null} now={now('a')} lead={false} />
          <Tile c={cb} v={null} now={now('b')} lead={false} />
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          A partir de 20% apurado: a estimativa do resultado final, com faixa de 95%, feita cidade por cidade. No gráfico, o caminho
          pontilhado até 100%.
        </p>
        <HowItWorks />
      </Section>
    );
  }
  const lo = Math.max(0, Math.min(p.lo, 100));
  const hi = Math.max(0, Math.min(p.hi, 100));
  const lead = leaderOf(p);
  const winner = lead ? board.candidates.find((c) => c.key === lead)! : null;
  return (
    <Section icon={TrendingUp} title="Para onde vai" meta={<Estimate pst={p.basedOnPst} />} className={className}>
      <div className="grid grid-cols-2 gap-2">
        <Tile c={ca} v={p.pa} lo={lo} hi={hi} now={now('a')} lead={lead === 'a'} />
        <Tile c={cb} v={100 - p.pa} lo={100 - hi} hi={100 - lo} now={now('b')} lead={lead === 'b'} />
      </div>
      <p className="mt-3 flex items-center gap-2 text-[12px]">
        {winner ? (
          <>
            <CandidateAvatar c={winner} size="xs" />
            <span>
              A faixa inteira aponta <strong style={{ color: winner.color }}>{winner.short}</strong> à frente.
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Indefinido: a faixa ainda cruza os 50%.</span>
        )}
      </p>
      <HowItWorks model={p.model} />
    </Section>
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
