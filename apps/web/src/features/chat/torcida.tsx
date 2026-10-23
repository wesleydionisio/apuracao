// Torcida do chat: "manda um 13 / 22", cabo-de-guerra com os totais e a escolha de lado.
import type { CandidateDef, Reaction, Room, Side } from '@apuracao/shared';
import { cheerOf } from '@apuracao/shared';
import { useState } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { live } from '@/lib/live';
import { cn } from '@/lib/utils';
import { spawnFloat } from './floats';

const fmtCount = (n: number) =>
  n >= 1_000_000
    ? `${(n / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
    : n >= 10_000
      ? `${Math.round(n / 1e3).toLocaleString('pt-BR')} mil`
      : n >= 1000
        ? `${(n / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`
        : String(n);

/** toques próprios recentes, para não contar duas vezes quando a rajada do servidor volta */
export const ownRecent = new Map<Reaction, { n: number; at: number }>();
export function markOwn(e: Reaction) {
  const cur = ownRecent.get(e);
  const fresh = cur && Date.now() - cur.at < 2500;
  ownRecent.set(e, { n: (fresh ? cur.n : 0) + 1, at: Date.now() });
}

function CheerButton({ c, onCheer, disabled, align }: { c: CandidateDef; onCheer: () => void; disabled: boolean; align: 'l' | 'r' }) {
  const [pop, setPop] = useState(0);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        onCheer();
        setPop((p) => p + 1);
      }}
      className={cn(
        'group relative flex h-10 shrink-0 items-center gap-1.5 rounded-full border bg-card pr-3 pl-1 transition-transform duration-150 ease-out active:scale-[0.94] disabled:opacity-40',
        align === 'r' && 'flex-row-reverse pr-1 pl-3',
      )}
      style={{ borderColor: `color-mix(in oklab, ${c.color} 40%, var(--border))` }}
      aria-label={`Manda um ${c.n}: torcer por ${c.short}`}
    >
      <CandidateAvatar c={c} size="sm" className="rounded-full" />
      <span key={pop} className={cn('flex flex-col leading-none', align === 'r' ? 'items-end' : 'items-start', pop && 'animate-in zoom-in-90 duration-150')}>
        <span className="text-[10px] font-medium text-muted-foreground">manda um</span>
        <span className="num text-[15px] font-bold" style={{ color: `color-mix(in oklab, ${c.color} 85%, var(--foreground))` }}>
          {c.n}
        </span>
      </span>
    </button>
  );
}

/** Faixa no topo do chat: botões de torcida nas pontas, cabo-de-guerra no meio. */
export function TorcidaBar({
  room,
  cands,
  counts,
  disabled,
  ensureSide,
}: {
  room: Room;
  cands: [CandidateDef, CandidateDef];
  counts: { a: number; b: number };
  disabled: boolean;
  ensureSide: (then: () => void, prefer?: Side) => void;
}) {
  const [ca, cb] = cands;
  const total = counts.a + counts.b;
  const share = total ? (counts.a / total) * 100 : 50;
  const cheer = (side: Side) =>
    ensureSide(() => {
      const e = cheerOf(side);
      live.cheer(room, side);
      markOwn(e);
      spawnFloat(e, 1);
      navigator.vibrate?.(10);
    }, side);
  return (
    <div className="flex items-center gap-2 px-3 py-1.5">
      <CheerButton c={ca} align="l" disabled={disabled} onCheer={() => cheer('a')} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between text-[11px] font-semibold tabular-nums">
          <span style={{ color: `color-mix(in oklab, ${ca.color} 85%, var(--foreground))` }}>{fmtCount(counts.a)}</span>
          <span className="truncate px-1 text-[10px] font-medium text-muted-foreground">torcida do chat</span>
          <span style={{ color: `color-mix(in oklab, ${cb.color} 85%, var(--foreground))` }}>{fmtCount(counts.b)}</span>
        </div>
        <div
          className="relative mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label={`Torcida do chat: ${ca.n} ${fmtCount(counts.a)}, ${cb.n} ${fmtCount(counts.b)}. Não é pesquisa.`}
        >
          {total > 0 && (
            <>
              <div className="h-full transition-[width] duration-700 ease-out" style={{ width: `${share}%`, background: ca.color }} />
              <div className="h-full flex-1" style={{ background: cb.color }} />
            </>
          )}
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-background" aria-hidden />
        </div>
        <div className="mt-0.5 text-center text-[9.5px] text-muted-foreground/80">não é pesquisa</div>
      </div>
      <CheerButton c={cb} align="r" disabled={disabled} onCheer={() => cheer('b')} />
    </div>
  );
}

