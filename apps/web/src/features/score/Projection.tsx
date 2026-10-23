// Projeção como intervalo (nunca número seco), sempre com "estimativa" e % apurado.
import type { Board } from '@apuracao/shared';
import { TrendingUp } from 'lucide-react';
import { CandidateAvatar } from '@/components/core/candidate';
import { Estimate } from '@/components/ui';
import { fmtPct } from '@/lib/format';
import { Section } from './Section';

export function ProjectionBand({ board, className }: { board: Board; className?: string }) {
  const p = board.projection;
  if (!board.flags.projection || !p) return null;
  const [ca, cb] = board.candidates;
  const lo = Math.max(0, Math.min(p.lo, 100));
  const hi = Math.max(0, Math.min(p.hi, 100));
  const mid = (lo + hi) / 2;
  // eixo adaptado ao intervalo (sempre contendo 50%), para a faixa não virar um risco
  const span = Math.max(8, Math.abs(lo - 50) + 3, Math.abs(hi - 50) + 3);
  const A = Math.max(0, Math.round(50 - span));
  const B = Math.min(100, Math.round(50 + span));
  const x = (v: number) => Math.max(0, Math.min(100, ((v - A) / (B - A)) * 100));
  const winner = hi < 50 ? cb : lo > 50 ? ca : null;
  return (
    <Section icon={TrendingUp} title="Para onde vai" meta={<Estimate pst={p.basedOnPst} />} className={className}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[12px] text-muted-foreground">Faixa estimada para {ca.short}</div>
          <div className="display mt-1 text-[24px] leading-none font-semibold">
            {fmtPct(lo, 1)}% a {fmtPct(hi, 1)}%
          </div>
        </div>
        {winner ? (
          <div className="flex items-center gap-2 text-right">
            <div className="text-[12px] leading-tight text-muted-foreground">
              termina à frente
              <div className="text-[13px] font-semibold" style={{ color: winner.color }}>
                {winner.short}
              </div>
            </div>
            <CandidateAvatar c={winner} size="sm" />
          </div>
        ) : (
          <div className="max-w-36 text-right text-[12px] leading-tight text-muted-foreground">a faixa cruza 50%: dá para os dois lados</div>
        )}
      </div>
      <div className="relative mt-4 h-9" role="img" aria-label={`Intervalo estimado para ${ca.short}: ${fmtPct(lo, 1)}% a ${fmtPct(hi, 1)}%`}>
        {/* fundo dividido: à direita de 50% A vence, à esquerda B */}
        <div className="absolute inset-x-0 top-3 flex h-3 overflow-hidden rounded-full">
          <div className="h-full" style={{ width: `${x(50)}%`, background: `color-mix(in oklab, ${cb.color} 22%, transparent)` }} />
          <div className="h-full flex-1" style={{ background: `color-mix(in oklab, ${ca.color} 22%, transparent)` }} />
        </div>
        <div
          className="absolute top-1.5 h-6 rounded-full border-2 border-card"
          style={{ left: `${x(lo)}%`, width: `${Math.max(2, x(hi) - x(lo))}%`, background: ca.color }}
        />
        <div className="absolute top-0.5 h-8 w-[3px] -translate-x-1/2 rounded-full bg-card" style={{ left: `${x(mid)}%` }} />
        <div className="absolute top-0 h-9 w-px bg-foreground/70" style={{ left: `${x(50)}%` }} />
      </div>
      <div className="num mt-1 flex justify-between text-[11px] text-muted-foreground">
        <span>{A}%</span>
        <span className="font-medium text-foreground">50%</span>
        <span>{B}%</span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        Se o que falta seguir o padrão de cada estado até aqui. Modelo simples, sem pesquisa, que pode errar: o resultado é o da
        totalização do TSE. {cb.short} fica com o complemento ({fmtPct(100 - hi, 1)}% a {fmtPct(100 - lo, 1)}%).
      </p>
    </Section>
  );
}
