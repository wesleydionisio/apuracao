// "Onde ainda falta": estados pelo peso de votos não apurados — quem lidera ali agora e como foi no 1º turno.
import type { Board, CandidateDef } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import { ChevronDown, Hourglass } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { Empty } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { fmtCompact, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from './Section';

type SortKey = 'rem' | 'pst' | 'margin';
const SORTS: { k: SortKey; label: string }[] = [
  { k: 'rem', label: 'Faltam' },
  { k: 'pst', label: 'Apurado' },
  { k: 'margin', label: 'Margem' },
];

const COLS = 'grid-cols-[minmax(0,1fr)_3.75rem_5rem_3.25rem]';

export function RemainingTable({ board, limit = 7, className }: { board: Board; limit?: number; className?: string }) {
  const [ca, cb] = board.candidates;
  const [all, setAll] = useState(false);
  const [sort, setSort] = useState<SortKey>('rem');
  const rows = useMemo(() => {
    const list = board.remaining.map((r) => {
      const s = board.ufs[`uf:${r.uf}`];
      const lead: CandidateDef | null = s?.lead === 'a' ? ca : s?.lead === 'b' ? cb : null;
      return { ...r, lead, margin: s && s.valid ? Math.abs(s.pa - s.pb) : null };
    });
    const by: Record<SortKey, (x: (typeof list)[number]) => number> = {
      rem: (x) => -x.rem,
      pst: (x) => x.pst,
      margin: (x) => x.margin ?? 999,
    };
    return list.sort((x, y) => by[sort](x) - by[sort](y));
  }, [board.remaining, board.ufs, ca, cb, sort]);
  const shown = all ? rows : rows.slice(0, limit);
  const total = board.remaining.reduce((s, r) => s + r.rem, 0);

  return (
    <Section
      icon={Hourglass}
      title="Onde ainda falta"
      meta={total > 0 ? <span className="num">~{fmtCompact(total)} votos</span> : undefined}
      className={className}
    >
      {!rows.length ? (
        <Empty title="Nada relevante a apurar">Todos os estados estão praticamente apurados.</Empty>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-1" role="group" aria-label="Ordenar por">
            <span className="mr-1 text-[12px] text-muted-foreground">Ordenar</span>
            {SORTS.map((s) => (
              <button
                key={s.k}
                type="button"
                aria-pressed={sort === s.k}
                onClick={() => setSort(s.k)}
                className={cn(
                  'press relative h-7 rounded-full px-2.5 text-[12px] font-medium before:absolute before:-inset-y-2 before:inset-x-0',
                  sort === s.k ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
          <div className={cn('grid gap-2 border-b pb-1.5 text-[11px] text-muted-foreground', COLS)} aria-hidden>
            <span>Estado</span>
            <span className="text-right">Faltam</span>
            <span className="text-right">Lidera agora</span>
            <span className="text-right">1º turno</span>
          </div>
          <ul className="divide-y" aria-label="Estados com mais votos a apurar">
            {shown.map((r) => (
              <li key={r.uf}>
                <Link
                  href={`/mapa/${r.uf}`}
                  className={cn('press -mx-1 grid min-h-14 items-center gap-2 rounded-lg px-1 hover:bg-accent/60', COLS)}
                  aria-label={`${ufName(r.uf)}: ${fmtPct(r.pst, 0)}% apurado, faltam ${fmtCompact(r.rem)} votos${r.lead && r.margin !== null ? `, ${r.lead.short} lidera por ${fmtPct(r.margin, 1)} pontos` : ''}`}
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-1.5">
                      <span className="w-6 shrink-0 text-[13px] font-semibold">{r.uf}</span>
                      <span className="truncate text-[12px] text-muted-foreground">{ufName(r.uf)}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-700" style={{ width: `${r.pst}%` }} />
                      </div>
                      <span className="num w-8 text-right text-[11px] text-muted-foreground">{fmtPct(r.pst, 0)}%</span>
                    </div>
                  </div>
                  <div className="display text-right text-[14px] font-semibold">{fmtCompact(r.rem)}</div>
                  <div className="flex items-center justify-end gap-1.5">
                    {r.lead && r.margin !== null ? (
                      <>
                        <span className="num text-[12px] font-semibold" style={{ color: r.lead.color }}>
                          +{fmtPct(r.margin, 1)}
                        </span>
                        <CandidateAvatar c={r.lead} size="xs" />
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    )}
                  </div>
                  <div className="flex justify-end">
                    {r.pa1 === null ? (
                      <span className="text-[11px] text-muted-foreground">—</span>
                    ) : (
                      <div className="flex h-1.5 w-full overflow-hidden rounded-full" title={`1º turno: ${ca.short} ${fmtPct(r.pa1, 1)}%`}>
                        <div style={{ width: `${r.pa1}%`, background: ca.color }} />
                        <div className="flex-1" style={{ background: cb.color }} />
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {rows.length > limit && (
            <Button variant="ghost" className="mt-1 h-11 w-full text-[13px] text-muted-foreground" onClick={() => setAll((v) => !v)}>
              {all ? 'Mostrar menos' : `Ver os ${rows.length} estados`}
              <ChevronDown className={cn('size-4 transition-transform', all && 'rotate-180')} aria-hidden />
            </Button>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">Margem em pontos sobre os votos válidos. 1º turno: só os dois finalistas.</p>
        </>
      )}
    </Section>
  );
}
