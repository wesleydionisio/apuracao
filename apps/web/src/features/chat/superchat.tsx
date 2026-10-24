// Super Chat no estilo do YouTube: cartão colorido no fluxo do chat e, nas faixas maiores, fixado no topo
// por um tempo que depende do valor (a fita encolhe até sair).
import type { CandidateDef, ChatMsg, Room } from '@apuracao/shared';
import { fmtBrl, scTier } from '@apuracao/shared';
import { useState } from 'react';
import { useNow } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useChat } from '@/store/chat';
import { NickAvatar, PartyBadge, renderBody } from './parts';

const EMPTY: ChatMsg[] = [];

/** corpo do cartão: a cor da faixa bem clara sobre o cartão (texto normal do tema por cima) */
const soft = (color: string) => `color-mix(in oklab, ${color} 18%, var(--card))`;

export function SuperLine({ m, cands, fresh, className }: { m: ChatMsg; cands: CandidateDef[] | null; fresh?: boolean; className?: string }) {
  const tier = scTier(m.sc ?? 0);
  const side = m.side ? cands?.find((c) => c.key === m.side) : null;
  return (
    <article
      className={cn('mx-2 my-1.5 overflow-hidden rounded-xl shadow-sm', fresh && 'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-300', className)}
      aria-label={`Super Chat de ${m.nick}, ${fmtBrl(m.sc ?? 0)}${m.body ? `: ${m.body}` : ''}`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: tier.color, color: tier.ink }}>
        <NickAvatar m={m} className="size-6 text-[11px] ring-2 ring-white/40" />
        <span className="min-w-0 truncate text-[13px] font-semibold">{m.nick}</span>
        {side && <PartyBadge c={side} />}
        <span className="num ml-auto shrink-0 text-[14px] font-bold">{fmtBrl(m.sc ?? 0)}</span>
      </div>
      {m.body && (
        <p className="px-3 py-2 text-[14px] leading-[1.45] break-words text-pretty" style={{ background: soft(tier.color) }}>
          {renderBody(m.body, cands)}
        </p>
      )}
    </article>
  );
}

/** Super Chats ainda no tempo de fixação, do mais novo para o mais velho */
function usePinned(room: Room) {
  const pins = useChat((s) => s.pins[room] ?? EMPTY);
  const now = useNow(1000);
  return {
    now,
    list: pins
      .map((m) => ({ m, until: m.at + scTier(m.sc ?? 0).pin * 1000 }))
      .filter((p) => p.until > now)
      .sort((a, b) => b.m.at - a.m.at),
  };
}

/** fita de Super Chats fixados; tocar abre o cartão inteiro por cima do chat */
export function PinnedBar({ room, cands }: { room: Room; cands: CandidateDef[] | null }) {
  const { list, now } = usePinned(room);
  const [open, setOpen] = useState<string | null>(null);
  if (!list.length) return null;
  const opened = list.find((p) => p.m.id === open)?.m;
  return (
    <div className="relative">
      <div className="flex gap-1.5 overflow-x-auto px-3 py-1.5 [scrollbar-width:none]" role="list" aria-label="Super Chats fixados">
        {list.map(({ m, until }) => {
          const tier = scTier(m.sc ?? 0);
          const left = Math.max(0, Math.min(1, (until - now) / (tier.pin * 1000)));
          return (
            <button
              key={m.id}
              type="button"
              role="listitem"
              onClick={() => setOpen((o) => (o === m.id ? null : m.id))}
              className="press flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-1 text-[12px] font-semibold"
              style={{
                color: tier.ink,
                // a parte cheia é o tempo que ainda falta
                background: `linear-gradient(90deg, ${tier.color} ${left * 100}%, color-mix(in oklab, ${tier.color} 55%, var(--card)) ${left * 100}%)`,
              }}
              aria-expanded={open === m.id}
              aria-label={`Super Chat de ${m.nick}, ${fmtBrl(m.sc ?? 0)}`}
            >
              <NickAvatar m={m} className="size-5 text-[10px]" />
              <span className="num">{fmtBrl(m.sc ?? 0)}</span>
            </button>
          );
        })}
      </div>
      {opened && (
        <div className="absolute inset-x-0 top-full z-20 animate-in fade-in-0 slide-in-from-top-1 duration-150" onClick={() => setOpen(null)}>
          <SuperLine m={opened} cands={cands} className="shadow-[var(--shadow-card)]" />
        </div>
      )}
    </div>
  );
}
