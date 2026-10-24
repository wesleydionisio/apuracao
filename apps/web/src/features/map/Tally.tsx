// Placar de estados: quantos estados cada um lidera e quanto eleitorado eles somam, num cabo de guerra.
import type { CandidateDef } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { Globe } from 'lucide-react';
import { CandidateAvatar } from '@/components/core/candidate';
import { fmtCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { UfValue } from './data';

const TOTAL = 27;

export function StateTally({
  values,
  electorate,
  cands,
  className,
  caption,
}: {
  values: Record<string, UfValue | undefined>;
  electorate: Record<string, number>;
  cands: CandidateDef[];
  className?: string;
  caption?: string;
}) {
  let a = 0;
  let b = 0;
  let elA = 0;
  let elB = 0;
  for (const [uf, v] of Object.entries(values)) {
    if (uf === 'ZZ' || uf === 'BR' || v?.pa == null) continue;
    if (v.pa > 50) {
      a++;
      elA += electorate[uf] ?? 0;
    } else if (v.pa < 50) {
      b++;
      elB += electorate[uf] ?? 0;
    }
  }
  const rest = Math.max(0, TOTAL - a - b);
  const abroad = values.ZZ?.pa ?? null;
  const side = (c: CandidateDef, n: number, el: number, right = false) => (
    <div className={cn('flex min-w-0 items-center gap-2.5', right && 'flex-row-reverse text-right')}>
      <CandidateAvatar c={c} size="md" />
      <div className="min-w-0">
        <div className={cn('flex items-baseline gap-1', right && 'justify-end')}>
          <span className="display text-[26px] font-semibold leading-none" style={{ color: c.color }}>
            <NumberFlow value={n} />
          </span>
          <span className="text-xs text-muted-foreground">{n === 1 ? 'estado' : 'estados'}</span>
        </div>
        <div className="num mt-1 truncate text-[11px] text-muted-foreground">{el ? `${fmtCompact(el)} eleitores` : c.short}</div>
      </div>
    </div>
  );
  return (
    <section className={cn('rounded-2xl border bg-card p-4', className)} aria-label={`${cands[0].short} lidera em ${a} estados, ${cands[1].short} em ${b}`}>
      <div className="flex items-center justify-between gap-3">
        {side(cands[0], a, elA)}
        {side(cands[1], b, elB, true)}
      </div>
      <div className="relative mt-3 flex h-2 gap-[2px]" aria-hidden>
        {Array.from({ length: TOTAL }, (_, i) => {
          const bg = i < a ? cands[0].color : i >= TOTAL - b ? cands[1].color : 'var(--muted)';
          return <span key={i} className="h-full flex-1 rounded-[2px] transition-colors duration-500" style={{ background: bg }} />;
        })}
        {/* o exterior: fora da contagem de estados, um quadradinho menor e apagado depois dos 27 */}
        <span
          className="ml-1 h-full w-2 shrink-0 rounded-[2px] opacity-50 transition-colors duration-500"
          style={{ background: abroad == null ? 'var(--muted)' : abroad > 50 ? cands[0].color : abroad < 50 ? cands[1].color : 'var(--muted)' }}
        />
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span className="truncate">{caption ?? 'Estados em que cada um está à frente'}</span>
        {/* não existe colégio eleitoral: nada de "N para maioria" — o que vale é o voto popular */}
        <span className="num flex shrink-0 items-center gap-2">
          {rest > 0 && <span>{rest} sem dado</span>}
          <span className="inline-flex items-center gap-0.5">
            <Globe className="size-3" aria-hidden />
            ext.
          </span>
        </span>
      </div>
    </section>
  );
}
