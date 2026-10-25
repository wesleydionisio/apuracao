// Os números oficiais da votação, em votos (não só em %): comparecimento, válidos, brancos, nulos e abstenção.
// Tudo das seções já apuradas, como o TSE divulga: válidos/brancos/nulos sobre quem votou, abstenção sobre o
// eleitorado dessas seções. Antes da apuração as linhas ficam no lugar, com traço.
import type { Snap } from '@apuracao/shared';
import { fmtInt, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';

export function VoteTotals({ snap, className }: { snap: Snap | null; className?: string }) {
  const s = snap && snap.turnout > 0 ? snap : null;
  const abst = s ? Math.max(0, s.elc - s.turnout) : 0;
  const ofVoters = (n: number) => (s ? `${fmtPct((n / s.turnout) * 100, 2)}%` : '—');
  const ofElc = (n: number) => (s && s.elc ? `${fmtPct((n / s.elc) * 100, 2)}%` : '—');
  const rows: { k: string; n: number | null; pct: string; hint: string; tone?: string; strong?: boolean }[] = [
    { k: 'Comparecimento', n: s?.turnout ?? null, pct: ofElc(s?.turnout ?? 0), hint: 'do eleitorado', strong: true },
    { k: 'Votos válidos', n: s?.valid ?? null, pct: ofVoters(s?.valid ?? 0), hint: 'de quem votou', tone: 'bg-foreground/70' },
    { k: 'Brancos', n: s?.blank ?? null, pct: ofVoters(s?.blank ?? 0), hint: 'de quem votou', tone: 'bg-muted-foreground/45' },
    { k: 'Nulos', n: s?.nulls ?? null, pct: ofVoters(s?.nulls ?? 0), hint: 'de quem votou', tone: 'bg-muted-foreground/25' },
    { k: 'Abstenção', n: s ? abst : null, pct: ofElc(abst), hint: 'do eleitorado', strong: true },
  ];
  // composição de quem votou: válidos | brancos | nulos
  const w = (n: number) => (s ? `${(n / s.turnout) * 100}%` : '0%');
  return (
    <div className={className}>
      <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-muted" aria-hidden>
        {s && (
          <>
            <div className="bg-foreground/70" style={{ width: w(s.valid) }} />
            <div className="bg-muted-foreground/45" style={{ width: w(s.blank) }} />
            <div className="flex-1 bg-muted-foreground/25" />
          </>
        )}
      </div>
      <dl className="mt-3 divide-y text-[13px]">
        {rows.map((r) => (
          <div key={r.k} className="flex items-baseline gap-3 py-2">
            <dt className={cn('flex min-w-0 flex-1 items-center gap-2 truncate', r.strong ? 'font-medium' : 'text-muted-foreground')}>
              {r.tone && <span className={cn('size-2 shrink-0 rounded-sm', r.tone)} aria-hidden />}
              {r.k}
            </dt>
            <dd className="num text-right font-semibold tabular-nums">{r.n === null ? '—' : fmtInt(r.n)}</dd>
            <dd className="num w-[4.75rem] shrink-0 text-right text-muted-foreground tabular-nums">
              {r.pct}
              <span className="sr-only"> {r.hint}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-1 text-[11.5px] text-muted-foreground text-pretty">
        {s ? (
          <>
            Nas seções apuradas: <span className="num">{fmtInt(s.elc)}</span> de <span className="num">{fmtInt(s.el)}</span> eleitores. Válidos,
            brancos e nulos sobre quem votou; comparecimento e abstenção sobre o eleitorado.
          </>
        ) : (
          'Os totais oficiais do TSE aparecem aqui a partir das 19h.'
        )}
      </p>
    </div>
  );
}
