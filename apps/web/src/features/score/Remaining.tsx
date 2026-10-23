// "Onde ainda falta": estados pelo peso de votos não apurados, com a tendência do 1º turno.
import type { Board } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { Card, Empty, Title } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { fmtCompact, fmtPct } from '@/lib/format';

export function RemainingTable({ board, limit = 7 }: { board: Board; limit?: number }) {
  const [ca, cb] = board.candidates;
  const [all, setAll] = useState(false);
  const rows = all ? board.remaining : board.remaining.slice(0, limit);
  return (
    <Card className="pb-2">
      <Title right={<span className="text-[11px] text-muted-foreground">tendência = 1º turno</span>}>Onde ainda falta</Title>
      {!rows.length ? (
        <Empty title="Nada relevante a apurar">Todos os estados estão praticamente apurados.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-[1fr_4.5rem_5.5rem] gap-2 pb-1.5 text-[11px] text-muted-foreground">
            <span>Estado · apurado</span>
            <span className="text-right">Faltam</span>
            <span className="text-right">Tendência</span>
          </div>
          <ul className="-mx-1 divide-y">
            {rows.map((r) => {
              const pa1 = r.pa1;
              const lead = pa1 === null ? null : pa1 >= 50 ? ca : cb;
              return (
                <li key={r.uf}>
                  <Link href={`/mapa/${r.uf}`} className="press grid min-h-13 grid-cols-[1fr_4.5rem_5.5rem] items-center gap-2 rounded-lg px-1 hover:bg-accent/60">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="w-6 shrink-0 text-[13px] font-semibold">{r.uf}</span>
                        <span className="truncate text-[12px] text-muted-foreground">{ufName(r.uf)}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-foreground/70" style={{ width: `${r.pst}%` }} />
                        </div>
                        <span className="num w-8 text-right text-[11px] text-muted-foreground">{fmtPct(r.pst, 0)}%</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="display text-[14px] font-semibold">{fmtCompact(r.rem)}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      {pa1 === null || !lead ? (
                        <span className="text-[11px] text-muted-foreground">—</span>
                      ) : (
                        <>
                          <span className="num text-[11px] font-semibold" style={{ color: lead.color }}>
                            {lead.short.split(' ')[0]} {fmtPct(Math.max(pa1, 100 - pa1), 0)}%
                          </span>
                          <div className="flex h-1 w-full overflow-hidden rounded-full" aria-hidden>
                            <div style={{ width: `${pa1}%`, background: ca.color }} />
                            <div className="flex-1" style={{ background: cb.color }} />
                          </div>
                        </>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          {board.remaining.length > limit && (
            <Button variant="ghost" className="mt-1 h-11 w-full text-[13px] text-muted-foreground" onClick={() => setAll((v) => !v)}>
              {all ? 'Mostrar menos' : `Ver os ${board.remaining.length} estados`}
              <ChevronDown className={`size-4 transition-transform ${all ? 'rotate-180' : ''}`} />
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
