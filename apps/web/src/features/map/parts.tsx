// Peças de apresentação do mapa e da cidade (linhas de candidato, barra versus, comparações).
import type { CandidateDef, HistRow, Snap } from '@apuracao/shared';
import { fmtInt, fmtPct, transfer } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { ArrowLeftRight, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { pair } from './colors';

export { pair };
import { fmtCompact } from '@/lib/format';

const PCT1 = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

export const STATUS: Record<Snap['status'], { label: string; tone: string }> = {
  nao_iniciada: { label: 'Não iniciada', tone: 'text-muted-foreground' },
  apurando: { label: 'Em apuração', tone: 'text-live' },
  definido: { label: 'Matematicamente definido', tone: 'text-foreground' },
  totalizado: { label: 'Totalizado pelo TSE', tone: 'text-foreground' },
};

export function StatusBadge({ s, className }: { s: Snap['status']; className?: string }) {
  const st = STATUS[s];
  return (
    <Badge variant="outline" className={cn('gap-1.5 rounded-full font-medium', st.tone, className)}>
      {s === 'apurando' && <span className="live-dot size-1.5 rounded-full bg-live" aria-hidden />}
      {s === 'totalizado' && <Check className="size-3" aria-hidden />}
      {st.label}
    </Badge>
  );
}

/** barra A × B com marca dos 50% */
export function VersusBar({ pa, cands, className, h = 'h-1.5' }: { pa: number; cands: CandidateDef[]; className?: string; h?: string }) {
  return (
    <div className={cn('relative flex w-full overflow-hidden rounded-full bg-muted', h, className)} aria-hidden>
      <div className="transition-[width] duration-500 ease-out" style={{ width: `${pa}%`, background: cands[0].color }} />
      <div className="flex-1" style={{ background: cands[1].color }} />
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-card" />
    </div>
  );
}

/** progresso da apuração: trilho fino + rótulo */
export function CountedBar({ pst, className }: { pst: number; className?: string }) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pst} aria-valuemin={0} aria-valuemax={100} aria-label="Urnas apuradas">
        <div className="h-full rounded-full bg-foreground/70 transition-[width] duration-500 ease-out" style={{ width: `${pst}%` }} />
      </div>
      <span className="num shrink-0 text-xs text-muted-foreground">{fmtPct(pst, 1)}% apurado</span>
    </div>
  );
}

/** linhas dos dois candidatos (g1 + Polymarket): foto, nome, votos; % grande à direita */
export function CandidateLines({ cands, snap, size = 'md' }: { cands: CandidateDef[]; snap: Snap; size?: 'md' | 'lg' }) {
  const rows = [
    { c: cands[0], pct: snap.pa, votes: snap.a, lead: snap.lead === 'a' },
    { c: cands[1], pct: snap.pb, votes: snap.b, lead: snap.lead === 'b' },
  ];
  return (
    <ul className="divide-y">
      {rows.map(({ c, pct, votes, lead }) => (
        <li key={c.key} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-center gap-3">
            <CandidateAvatar c={c} size={size === 'lg' ? 'lg' : 'md'} ring={lead} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold leading-tight text-balance">{c.short}</div>
              <div className="num mt-0.5 text-xs text-muted-foreground">
                {c.party && <span className="font-medium">{c.party} · </span>}
                {fmtInt(votes)} votos
              </div>
            </div>
            <div className="text-right">
              <div className={cn('display font-semibold leading-none', size === 'lg' ? 'text-[32px]' : 'text-[26px]')}>
                <NumberFlow value={pct} format={PCT1} locales="pt-BR" suffix="%" />
              </div>
              {lead && <div className="mt-1 text-[11px] font-medium text-muted-foreground">à frente</div>}
            </div>
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full transition-[width] duration-500 ease-out" style={{ width: `${pct}%`, background: c.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** uma linha de comparação: rótulo, A% × B%, barra */
export function CompareRow({
  label,
  hint,
  pa,
  cands,
  strong,
}: {
  label: ReactNode;
  hint?: ReactNode;
  pa: number | null;
  cands: CandidateDef[];
  strong?: boolean;
}) {
  return (
    <li className={cn('py-3', strong && 'font-medium')}>
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <div className={cn('truncate text-sm', strong ? 'text-foreground' : 'text-foreground/90')}>{label}</div>
          {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
        </div>
        {pa === null ? (
          <span className="text-sm text-muted-foreground">sem dado</span>
        ) : (
          <span className="num shrink-0 text-sm font-semibold">
            <span style={{ color: cands[0].color }}>{pair(pa)[0]}</span>
            <span className="mx-1 text-muted-foreground">×</span>
            <span style={{ color: cands[1].color }}>{pair(pa)[1]}</span>
          </span>
        )}
      </div>
      {pa !== null && <VersusBar pa={pa} cands={cands} className="mt-2" h="h-1" />}
    </li>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
      <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
      {right}
    </div>
  );
}

/** "Virou de lado": destaque sóbrio, sem emoji */
export function FlipNote({ place, from, to }: { place: string; from: CandidateDef; to: CandidateDef }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border bg-muted/50 p-3">
      <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-background" aria-hidden>
        <ArrowLeftRight className="size-4" />
      </span>
      <p className="text-sm leading-snug">
        <span className="font-semibold">{place} virou de lado.</span> Em 2022 deu{' '}
        <span className="font-medium" style={{ color: from.color }}>{from.short}</span>; agora{' '}
        <span className="font-medium" style={{ color: to.color }}>{to.short}</span> está à frente.
      </p>
    </div>
  );
}

/** De onde vieram os votos: ganho de cada um sobre o 1º turno, como parte do "estoque" */
export function TransferBlock({ snap, t1, cands, place }: { snap: Snap; t1: HistRow; cands: CandidateDef[]; place: string }) {
  const t = transfer(snap, t1, cands);
  if (t.stock <= 0) return null;
  const rows = [
    { c: cands[0], gain: t.gainA, pct: t.pctA },
    { c: cands[1], gain: t.gainB, pct: t.pctB },
  ];
  const lost = Math.max(0, 100 - (t.pctA ?? 0) - (t.pctB ?? 0));
  return (
    <div>
      <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
        {place.charAt(0).toUpperCase() + place.slice(1)}, <span className="num font-medium text-foreground">{fmtCompact(t.stock)}</span> votos estavam "livres" em relação ao 1º turno (eliminados, brancos, nulos e quem não votou).
        {t.scale < 1 && ' Proporcional ao que já foi apurado.'}
      </p>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
        {rows.map(({ c, pct }) => (
          <div key={c.key} style={{ width: `${Math.max(0, pct ?? 0)}%`, background: c.color }} />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-3">
        {rows.map(({ c, gain, pct }) => (
          <li key={c.key} className="flex items-center gap-2">
            <CandidateAvatar c={c} size="sm" />
            <div className="min-w-0">
              <div className="num text-sm font-semibold">
                {gain >= 0 ? '+' : '−'}
                {fmtCompact(Math.abs(gain))}
              </div>
              <div className="num text-[11px] text-muted-foreground">
                {gain < 0 ? 'perdeu votos vs 1º turno' : pct === null ? '—' : `${fmtPct(pct, 0)}% do estoque`}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {lost > 1 && <p className="num mt-2 text-[11px] text-muted-foreground">{fmtPct(lost, 0)}% do estoque não foi para nenhum dos dois até agora.</p>}
    </div>
  );
}
