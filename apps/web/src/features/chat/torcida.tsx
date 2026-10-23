// Torcida do chat: o placar dos "bumps" no topo (só leitura) e o botão de torcer ao lado do campo de texto.
import type { CandidateDef, Reaction, Room } from '@apuracao/shared';
import { cheerOf } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { useEffect, useRef, useState } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { live } from '@/lib/live';
import { cn } from '@/lib/utils';
import { spawnFloat } from './floats';
import { SplitFill } from '@/components/core/bars';

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

const colorOf = (c: CandidateDef) => `color-mix(in oklab, ${c.color} 85%, var(--foreground))`;

/** pulso curto quando o número sobe (a torcida chegando ao vivo) */
function usePulse(v: number) {
  const prev = useRef(v);
  const [k, setK] = useState(0);
  useEffect(() => {
    if (v > prev.current) setK((x) => x + 1);
    prev.current = v;
  }, [v]);
  return k;
}

function Side({ c, n, lead, align }: { c: CandidateDef; n: number; lead: boolean; align: 'l' | 'r' }) {
  const pulse = usePulse(n);
  return (
    <div className={cn('flex min-w-0 items-center gap-2', align === 'r' && 'flex-row-reverse')}>
      <span className="relative shrink-0">
        <CandidateAvatar c={c} size="sm" ring={lead} className={cn('rounded-full transition-opacity duration-300', !lead && 'opacity-80')} />
        {pulse > 0 && (
          <span
            key={pulse}
            className="pointer-events-none absolute inset-0 rounded-full animate-out fade-out-0 zoom-out-150 duration-700 fill-mode-forwards"
            style={{ boxShadow: `0 0 0 3px ${c.color}` }}
            aria-hidden
          />
        )}
      </span>
      <div className={cn('flex min-w-0 flex-col leading-none', align === 'r' ? 'items-end' : 'items-start')}>
        <span className="num text-[11px] font-bold" style={{ color: colorOf(c) }}>
          {c.n}
        </span>
        <span key={pulse} className={cn('mt-0.5 inline-block', pulse > 0 && 'animate-in zoom-in-110 duration-200')}>
          <NumberFlow value={n} locales="pt-BR" format={{ notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }} className="num text-[19px] font-extrabold tracking-tight" />
        </span>
      </div>
    </div>
  );
}

/**
 * Placar da torcida no topo do chat: só leitura (quem torce aperta o botão ao lado do campo de texto).
 * Os dois lados com o total de "bumps", quem está na frente e o cabo-de-guerra.
 */
export function TorcidaBar({ cands, counts }: { cands: [CandidateDef, CandidateDef]; counts: { a: number; b: number } }) {
  const [ca, cb] = cands;
  const total = counts.a + counts.b;
  const share = total ? (counts.a / total) * 100 : 50;
  const lead = counts.a === counts.b ? null : counts.a > counts.b ? ca : cb;
  const pctA = Math.round(share);
  return (
    <div className="px-3.5 pt-2 pb-2.5" role="group" aria-label={`Torcida do chat (não é pesquisa): ${ca.short} ${counts.a}, ${cb.short} ${counts.b}`}>
      <div className="flex items-center justify-between gap-2">
        <Side c={ca} n={counts.a} lead={lead === ca} align="l" />
        <div className="flex min-w-0 flex-col items-center text-center leading-none">
          <span className="text-[10px] font-semibold tracking-[0.12em] text-muted-foreground uppercase">Torcida do chat</span>
          <span
            className="mt-1 truncate text-[12.5px] font-semibold transition-colors duration-300"
            style={{ color: lead ? colorOf(lead) : undefined }}
          >
            {!total ? 'Aperte para torcer' : lead ? `${lead.n} na frente por ${fmtCount(Math.abs(counts.a - counts.b))}` : 'Empate'}
          </span>
        </div>
        <Side c={cb} n={counts.b} lead={lead === cb} align="r" />
      </div>
      <div className="relative mt-2 h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        {total > 0 && <SplitFill pa={share} colorA={ca.color} colorB={cb.color} gap={2} />}
        <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-background/70" />
      </div>
      <div className="mt-1 flex justify-between text-[10.5px] font-medium text-muted-foreground tabular-nums">
        <span style={{ color: total ? colorOf(ca) : undefined }}>{total ? `${pctA}%` : '–'}</span>
        <span>não é pesquisa</span>
        <span style={{ color: total ? colorOf(cb) : undefined }}>{total ? `${100 - pctA}%` : '–'}</span>
      </div>
    </div>
  );
}

/** Botão ao lado do campo de texto: cada toque empurra o seu candidato na torcida. */
export function BumpButton({ room, c, disabled }: { room: Room; c: CandidateDef; disabled: boolean }) {
  const [pop, setPop] = useState(0);
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e) => e.preventDefault()}
      onClick={() => {
        const e = cheerOf(c.key);
        live.cheer(room, c.key);
        markOwn(e);
        spawnFloat(e, 1);
        navigator.vibrate?.(8);
        setPop((p) => p + 1);
      }}
      className="relative flex size-10 shrink-0 items-center justify-center rounded-full transition-transform duration-100 ease-out select-none active:scale-90 disabled:opacity-40"
      style={{ boxShadow: `0 0 0 2px ${c.color}, 0 6px 16px -6px ${c.color}` }}
      aria-label={`Torcer por ${c.short} (${c.n})`}
    >
      <span key={pop} className={cn('block size-full overflow-hidden rounded-full', pop > 0 && 'animate-in zoom-in-75 duration-200')}>
        <CandidateAvatar c={c} size="sm" className="size-full rounded-full" />
      </span>
      <span
        className="num absolute -right-1.5 -bottom-1 rounded-full px-1 text-[10px] leading-[15px] font-bold text-white ring-2 ring-background"
        style={{ background: c.color }}
        aria-hidden
      >
        {c.n}
      </span>
    </button>
  );
}
