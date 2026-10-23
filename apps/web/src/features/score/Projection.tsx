// Projeção como intervalo (nunca número seco), sempre com "estimativa" e % apurado.
import type { Board } from '@apuracao/shared';
import { Card, Estimate, Title } from '@/components/ui';
import { fmtPct } from '@/lib/format';

export function ProjectionBand({ board }: { board: Board }) {
  const p = board.projection;
  if (!board.flags.projection || !p) return null;
  const [ca, cb] = board.candidates;
  const lo = Math.max(0, Math.min(p.lo, 100));
  const hi = Math.max(0, Math.min(p.hi, 100));
  // eixo 35–65%: o intervalo fica legível no celular
  const A = 35;
  const B = 65;
  const x = (v: number) => Math.max(0, Math.min(100, ((v - A) / (B - A)) * 100));
  const leftWins = hi < 50;
  const rightWins = lo > 50;
  return (
    <Card>
      <Title right={<Estimate pst={p.basedOnPst} />}>Para onde vai</Title>
      <p className="text-[14px] leading-relaxed">
        Se o que falta seguir o padrão observado até aqui, <strong style={{ color: ca.color }}>{ca.short}</strong> termina entre{' '}
        <strong className="num">{fmtPct(lo, 1)}%</strong> e <strong className="num">{fmtPct(hi, 1)}%</strong> dos votos válidos.
      </p>
      <div className="relative mt-5 h-12" role="img" aria-label={`Intervalo estimado para ${ca.short}: ${fmtPct(lo, 1)}% a ${fmtPct(hi, 1)}%`}>
        {/* fundo dividido: lado de A à direita de 50% = A vence */}
        <div className="absolute inset-x-0 top-4 flex h-3 overflow-hidden rounded-full">
          <div className="h-full" style={{ width: `${x(50)}%`, background: `color-mix(in oklab, ${cb.color} 18%, transparent)` }} />
          <div className="h-full flex-1" style={{ background: `color-mix(in oklab, ${ca.color} 18%, transparent)` }} />
        </div>
        <div
          className="absolute top-2.5 h-6 rounded-full border-2 border-background"
          style={{ left: `${x(lo)}%`, width: `${Math.max(1.5, x(hi) - x(lo))}%`, background: ca.color }}
        />
        <div className="absolute top-0 h-12 w-px bg-foreground/60" style={{ left: `${x(50)}%` }} />
      </div>
      <div className="num flex justify-between text-[11px] text-muted-foreground">
        <span>{A}%</span>
        <span className="font-medium text-foreground">50%</span>
        <span>{B}%</span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
        {leftWins
          ? `Neste intervalo, ${cb.short} termina à frente.`
          : rightWins
            ? `Neste intervalo, ${ca.short} termina à frente.`
            : 'O intervalo cruza os 50%: dá para os dois lados.'}{' '}
        Não é resultado: modelo simples, sem pesquisa, que pode errar. Vale a totalização do TSE.
      </p>
    </Card>
  );
}
