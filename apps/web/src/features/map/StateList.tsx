// Lista de estados: alternativa acessível ao mapa, ordenável. Densa, estilo mercado.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct, ufName } from '@apuracao/shared';
import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fmtCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { fillFor, leaderOf, marginPts } from './colors';
import type { UfValue } from './data';

type Sort = 'el' | 'margin' | 'pst';

export function StateList({
  values,
  electorate,
  cands,
  onPick,
  showPst,
}: {
  values: Record<string, UfValue | undefined>;
  /** eleitorado por UF (do placar ou do histórico) */
  electorate: Record<string, number>;
  cands: CandidateDef[];
  onPick: (uf: string) => void;
  showPst: boolean;
}) {
  const [sort, setSort] = useState<Sort>('el');
  const rows = useMemo(() => {
    const ufs = Object.keys({ ...electorate, ...values }).filter((u) => u !== 'BR');
    const key = (uf: string) => {
      const v = values[uf];
      if (sort === 'margin') return v?.pa == null ? -1 : marginPts(v.pa);
      if (sort === 'pst') return v?.pst ?? -1;
      return electorate[uf] ?? 0;
    };
    return ufs.sort((x, y) => key(y) - key(x));
  }, [values, electorate, sort]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">Ordenar por</span>
        <ToggleGroup type="single" size="sm" variant="outline" value={sort} onValueChange={(v) => v && setSort(v as Sort)} aria-label="Ordenar estados">
          <ToggleGroupItem value="el">Eleitores</ToggleGroupItem>
          <ToggleGroupItem value="margin">Diferença</ToggleGroupItem>
          {showPst && <ToggleGroupItem value="pst">Apuração</ToggleGroupItem>}
        </ToggleGroup>
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {rows.map((uf) => {
          const v = values[uf];
          const lead = v?.pa != null ? leaderOf(v.pa, cands) : null;
          return (
            <li key={uf}>
              <button
                type="button"
                onClick={() => onPick(uf)}
                className="press flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left hover:bg-accent/50"
              >
                <span
                  className="grid h-8 w-9 shrink-0 place-items-center rounded-md text-[11px] font-semibold"
                  style={{ background: fillFor(v?.pa, cands), color: v?.pa != null && marginPts(v.pa) >= 5 ? '#fff' : 'var(--foreground)' }}
                >
                  {uf}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{ufName(uf)}</span>
                  <span className="num flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span>{fmtCompact(electorate[uf] ?? 0)} eleitores</span>
                    {showPst && v?.pst != null && (
                      <span className="flex items-center gap-1" aria-label={`${fmtPct(v.pst, 0)}% apurado`}>
                        <span className="h-1 w-10 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <span className="block h-full rounded-full bg-foreground/60" style={{ width: `${v.pst}%` }} />
                        </span>
                        {fmtPct(v.pst, 0)}%
                      </span>
                    )}
                  </span>
                </span>
                {lead && v?.pa != null ? (
                  <span className="flex shrink-0 items-center gap-2">
                    <CandidateAvatar c={lead} size="xs" />
                    <span className="num w-12 text-right text-sm font-semibold" style={{ color: lead.color }}>
                      +{fmtPct(marginPts(v.pa), 1)}
                    </span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">sem dados</span>
                )}
                <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground')} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-[11px] text-muted-foreground">"+8,2" = vantagem de quem lidera, em pontos percentuais dos votos válidos.</p>
    </div>
  );
}
