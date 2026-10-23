// Rankings sob o mapa: maiores vantagens e quem mais se deslocou em relação a uma referência.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct, ufName } from '@apuracao/shared';
import { Scale, TrendingUp } from 'lucide-react';
import { CandidateAvatar } from '@/components/core/candidate';
import { DataTip } from '@/components/core/datatip';
import { cn } from '@/lib/utils';
import { fillFor, leaderOf, marginPts } from './colors';
import type { UfValue } from './data';
import { SectionTitle, Swing, VersusBar } from './parts';

/** bloquinho da sigla na cor do estado (mesma escala do mapa) */
export function UfChip({ uf, pa, cands, className }: { uf: string; pa: number | null | undefined; cands: CandidateDef[]; className?: string }) {
  return (
    <span
      className={cn('grid h-7 w-8 shrink-0 place-items-center rounded-md text-[11px] font-semibold', className)}
      style={{ background: fillFor(pa, cands), color: pa != null && marginPts(pa) >= 5 ? 'var(--on-fill)' : 'var(--foreground)' }}
      aria-hidden
    >
      {uf}
    </span>
  );
}

const ROWS = 6;
const MAX_SWING = 16;

export function MapRankings({
  values,
  swing,
  refLabel,
  cands,
  onPick,
  className,
}: {
  values: Record<string, UfValue | undefined>;
  /** deslocamento de A por UF em relação à referência (agora − ref) */
  swing: Record<string, number | null>;
  refLabel: string;
  cands: CandidateDef[];
  onPick: (uf: string) => void;
  className?: string;
}) {
  const ufs = Object.keys(values).filter((u) => u !== 'ZZ' && u !== 'BR');
  const byMargin = ufs
    .filter((u) => values[u]?.pa != null)
    .sort((x, y) => marginPts(values[y]!.pa!) - marginPts(values[x]!.pa!))
    .slice(0, ROWS);
  const bySwing = ufs
    .filter((u) => swing[u] != null)
    .sort((x, y) => Math.abs(swing[y]!) - Math.abs(swing[x]!))
    .slice(0, ROWS);
  if (!byMargin.length && !bySwing.length) return null;

  return (
    <div className={cn('grid gap-4 lg:grid-cols-2', className)}>
      {!!byMargin.length && (
        <section className="rounded-2xl border bg-card p-4">
          <SectionTitle icon={Scale} meta="em pontos">
            Maiores vantagens
          </SectionTitle>
          <ol className="divide-y">
            {byMargin.map((uf, i) => {
              const pa = values[uf]!.pa!;
              const lead = leaderOf(pa, cands);
              return (
                <li key={uf}>
                  <button type="button" onClick={() => onPick(uf)} className="press flex min-h-12 w-full items-center gap-3 py-2 text-left">
                    <span className="num w-3 text-[11px] text-muted-foreground">{i + 1}</span>
                    <UfChip uf={uf} pa={pa} cands={cands} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{ufName(uf)}</span>
                      <VersusBar pa={pa} cands={cands} h="h-1" className="mt-1.5 max-w-36" title={ufName(uf)} nested />
                    </span>
                    <CandidateAvatar c={lead} size="xs" />
                    <span className="num w-11 text-right text-[13px] font-semibold" style={{ color: lead.color }}>
                      +{fmtPct(marginPts(pa), 1)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {!!bySwing.length && (
        <section className="rounded-2xl border bg-card p-4">
          <SectionTitle icon={TrendingUp} meta={`vs ${refLabel}`}>
            Quem mais mudou
          </SectionTitle>
          <ol className="divide-y">
            {bySwing.map((uf) => {
              const d = swing[uf]!;
              const c = d > 0 ? cands[0] : cands[1];
              const w = Math.min(50, (Math.abs(d) / MAX_SWING) * 50);
              return (
                <li key={uf}>
                  <button type="button" onClick={() => onPick(uf)} className="press flex min-h-12 w-full items-center gap-3 py-2 text-left">
                    {/* sigla neutra: a cor aqui é a do deslocamento, não a de quem lidera */}
                    <UfChip uf={uf} pa={null} cands={cands} className="bg-muted!" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{ufName(uf)}</span>
                      {/* barra divergente: para a esquerda = rumo a A, para a direita = rumo a B */}
                      <DataTip
                        nested
                        className="mt-1.5 max-w-36"
                        label={`${ufName(uf)}: ${fmtPct(Math.abs(d), 1)} pontos rumo a ${c.short} desde ${refLabel}`}
                        tip={
                          <div className="num">
                            <div className="font-semibold">{ufName(uf)}</div>
                            <span className="inline-flex items-center gap-1.5">
                              <span className="size-2 rounded-full" style={{ background: c.color }} />
                              {fmtPct(Math.abs(d), 1)} pts rumo a {c.short}
                            </span>
                            <div className="text-[11px] text-muted-foreground">desde {refLabel}</div>
                          </div>
                        }
                      >
                        <span className="relative block h-1 rounded-full bg-muted" aria-hidden>
                          <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/40" />
                          <span
                            className="absolute inset-y-0 rounded-full"
                            style={{ background: c.color, width: `${w}%`, [d > 0 ? 'right' : 'left']: '50%' }}
                          />
                        </span>
                      </DataTip>
                    </span>
                    <Swing v={d} cands={cands} className="w-14 justify-end text-[13px]" />
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-2 text-[12px] text-muted-foreground">Pontos que cada estado andou na direção de um dos dois, comparado a {refLabel}.</p>
        </section>
      )}
    </div>
  );
}
