// Números da apuração em grade 3×2 (celular) — cada célula: rótulo, valor e um contexto/micro-visual.
import type { Board, HistRow, Snap } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import type { ReactNode } from 'react';
import { fmtCompact, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Fill } from '@/components/core/bars';
import { DataTip, SplitTip } from '@/components/core/datatip';

const TWO = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const ONE = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

function Cell({ label, value, sub, className }: { label: string; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 bg-card px-3 py-3', className)}>
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="display mt-1 truncate text-[18px] leading-none font-semibold">{value}</dd>
      {sub && <div className="mt-2 min-h-3.5 text-[11px] leading-tight text-muted-foreground">{sub}</div>}
    </div>
  );
}

/** 28 quadradinhos (27 UFs + exterior): cor de quem lidera nos decididos, cinza no resto */
function DecidedStrip({ board }: { board: Board }) {
  const [ca, cb] = board.candidates;
  const ufs = Object.values(board.ufs).sort((x, y) => y.el - x.el);
  const doneBy = (k: 'a' | 'b') => ufs.filter((s) => (s.status === 'definido' || s.status === 'totalizado') && s.lead === k).length;
  return (
    // cada quadradinho é um estado: passar o mouse ou tocar mostra qual e como está
    <div className="flex flex-wrap gap-[2px]" role="img" aria-label={`Decididos: ${doneBy('a')} para ${ca.short}, ${doneBy('b')} para ${cb.short}`}>
      {ufs.map((s) => {
        const done = s.status === 'definido' || s.status === 'totalizado';
        const c = s.lead === 'a' ? ca : s.lead === 'b' ? cb : null;
        const uf = s.s.slice(3);
        return (
          <DataTip
            key={s.s}
            nested
            className="p-[1px] -m-[1px]"
            label={`${ufName(uf)}: ${done ? 'decidido' : 'em apuração'}`}
            tip={
              <SplitTip
                cands={board.candidates}
                pa={s.valid ? s.pa : null}
                title={ufName(uf)}
                extra={`${fmtPct(s.pst, 0)}% apurado · ${done ? 'decidido' : 'em aberto'}`}
              />
            }
          >
            <span
              className="block size-[7px] rounded-[2px]"
              style={{ background: done && c ? c.color : c ? `color-mix(in oklab, ${c.color} 28%, var(--muted))` : 'var(--muted)' }}
            />
          </DataTip>
        );
      })}
    </div>
  );
}

export function Kpis({ board, snap, t1, className }: { board: Board; snap: Snap; t1?: HistRow | null; className?: string }) {
  const lead = board.candidates.find((c) => c.key === snap.lead);
  const diff = Math.abs(snap.a - snap.b);
  const pts = Math.abs(snap.pa - snap.pb);
  const turnout = snap.elc ? (snap.turnout / snap.elc) * 100 : null;
  const t1Turnout = t1?.el ? (t1.turnout / t1.el) * 100 : null;
  const bn = snap.turnout ? ((snap.blank + snap.nulls) / snap.turnout) * 100 : null;
  const t1Bn = t1?.turnout ? ((t1.blank + t1.nulls) / t1.turnout) * 100 : null;
  const ufs = Object.values(board.ufs);
  const decided = ufs.filter((s) => s.status === 'definido' || s.status === 'totalizado').length;
  return (
    <dl className={cn('grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border', className)}>
      <Cell
        label="Urnas apuradas"
        value={<NumberFlow value={snap.pst} format={TWO} locales="pt-BR" suffix="%" />}
        sub={
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <Fill pct={snap.pst} className="rounded-full bg-foreground" />
          </div>
        }
      />
      <Cell
        label="Diferença"
        value={snap.valid ? fmtCompact(diff) : '—'}
        sub={
          lead ? (
            <span className="flex items-center gap-1">
              <span className="size-1.5 shrink-0 rounded-full" style={{ background: lead.color }} />
              <span className="num truncate">{fmtPct(pts, 1)} pts</span>
            </span>
          ) : (
            'empate'
          )
        }
      />
      <Cell label="A apurar" value={snap.rem > 0 ? `~${fmtCompact(snap.rem)}` : '—'} sub="estimativa" />
      <Cell
        label="Comparecimento"
        value={turnout === null ? '—' : <NumberFlow value={turnout} format={ONE} locales="pt-BR" suffix="%" />}
        sub={t1Turnout !== null ? <span className="num">1º turno {fmtPct(t1Turnout, 1)}%</span> : 'nas urnas apuradas'}
      />
      <Cell
        label="Brancos e nulos"
        value={bn === null ? '—' : <NumberFlow value={bn} format={ONE} locales="pt-BR" suffix="%" />}
        sub={t1Bn !== null ? <span className="num">1º turno {fmtPct(t1Bn, 1)}%</span> : 'dos votos'}
      />
      <Cell
        label="UFs decididas"
        value={
          <span>
            {decided}
            <span className="text-[13px] font-medium text-muted-foreground"> de {ufs.length || 28}</span>
          </span>
        }
        sub={ufs.length ? <DecidedStrip board={board} /> : undefined}
      />
    </dl>
  );
}
