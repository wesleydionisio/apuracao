// Linha de estatísticas: urnas apuradas, diferença, votos que faltam, comparecimento.
import type { Snap } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { Progress } from '@/components/ui/progress';
import { fmtCompact } from '@/lib/format';
import { cn } from '@/lib/utils';

const ONE = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

function Stat({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0 px-3 py-3 first:pl-0', className)}>
      <dt className="truncate text-[11px] text-muted-foreground">{label}</dt>
      <dd className="display mt-1 text-[17px] leading-none font-semibold">{children}</dd>
    </div>
  );
}

export function StatsStrip({ snap, className }: { snap: Snap; className?: string }) {
  const diff = Math.abs(snap.a - snap.b);
  const turnout = snap.elc ? (snap.turnout / snap.elc) * 100 : null;
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[12px] text-muted-foreground">Urnas apuradas</span>
        <span className="display text-[15px] font-semibold">
          <NumberFlow value={snap.pst} format={{ minimumFractionDigits: 2, maximumFractionDigits: 2 }} locales="pt-BR" suffix="%" />
        </span>
      </div>
      <Progress value={snap.pst} className="h-1.5 bg-muted [&>*]:bg-foreground" aria-label="Urnas apuradas" />
      <dl className="mt-1 grid grid-cols-3 divide-x">
        <Stat label="Diferença">{fmtCompact(diff)}</Stat>
        <Stat label="Faltam (estim.)">{snap.rem > 0 ? `~${fmtCompact(snap.rem)}` : '—'}</Stat>
        <Stat label="Comparecimento">
          {turnout === null ? '—' : <NumberFlow value={turnout} format={ONE} locales="pt-BR" suffix="%" />}
        </Stat>
      </dl>
    </div>
  );
}
