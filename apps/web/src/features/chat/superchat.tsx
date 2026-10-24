// Super Chat no estilo do YouTube: cartão colorido no fluxo do chat e, nas faixas maiores, fixado no topo
// por um tempo que depende do valor (a fita encolhe até sair).
import type { CandidateDef, ChatMsg, Room } from '@apuracao/shared';
import { fmtBrl, scTier } from '@apuracao/shared';
import { useEffect, useRef, useState } from 'react';
import { useNow } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useChat } from '@/store/chat';
import { NickAvatar, PartyBadge, renderBody } from './parts';

const EMPTY: ChatMsg[] = [];

/** corpo do cartão: a cor bem clara sobre o cartão (texto normal do tema por cima) */
const soft = (color: string) => `color-mix(in oklab, ${color} 18%, var(--card))`;

/**
 * Cor do Super Chat: a do lado de quem mandou (PT/PL, a mesma do selo), um pouco escurecida para o texto branco passar
 * de 4,5:1. Sem lado escolhido, a cor da faixa de valor. O valor decide o tempo fixado e o tamanho do texto, não a cor.
 */
export function scColors(m: Pick<ChatMsg, 'sc' | 'side'>, cands: CandidateDef[] | null) {
  const side = m.side ? cands?.find((c) => c.key === m.side) : null;
  if (side) return { bg: `color-mix(in oklab, ${side.color} 80%, black)`, ink: '#ffffff', base: side.color, side };
  const tier = scTier(m.sc ?? 0);
  return { bg: tier.color, ink: tier.ink, base: tier.color, side: null };
}

export function SuperLine({ m, cands, fresh, className }: { m: ChatMsg; cands: CandidateDef[] | null; fresh?: boolean; className?: string }) {
  const { bg, ink, base, side } = scColors(m, cands);
  return (
    <article
      className={cn('mx-2 my-1.5 overflow-hidden rounded-xl shadow-sm', fresh && 'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2 duration-300', className)}
      aria-label={`Super Chat de ${m.nick}, ${fmtBrl(m.sc ?? 0)}${m.body ? `: ${m.body}` : ''}`}
    >
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ background: bg, color: ink }}>
        <NickAvatar m={m} className="size-6 text-[11px] ring-2 ring-white/40" />
        <span className="min-w-0 truncate text-[13px] font-semibold">{m.nick}</span>
        {side && <PartyBadge c={side} className="ring-1 ring-white/50" />}
        <span className="num ml-auto shrink-0 text-[14px] font-bold">{fmtBrl(m.sc ?? 0)}</span>
      </div>
      {m.body && (
        <p className="px-3 py-2 text-[14px] leading-[1.45] break-words text-pretty" style={{ background: soft(base) }}>
          {renderBody(m.body, cands)}
        </p>
      )}
    </article>
  );
}

/** quanto tempo cada Super Chat novo fica inteiro no topo, para todo mundo ler, antes de recolher para a fita */
const FEATURE_MS = 5000;

/** maior valor primeiro; empate, o mais novo */
const byValue = (a: ChatMsg, b: ChatMsg) => (b.sc ?? 0) - (a.sc ?? 0) || b.at - a.at;

/** Super Chats ainda no tempo de fixação, do maior valor para o menor */
function usePinned(room: Room) {
  const pins = useChat((s) => s.pins[room] ?? EMPTY);
  const now = useNow(500);
  return {
    now,
    pins,
    list: pins
      .map((m) => ({ m, until: m.at + scTier(m.sc ?? 0).pin * 1000 }))
      .filter((p) => p.until > now)
      .sort((a, b) => byValue(a.m, b.m)),
  };
}

/**
 * O destaque, estilo YouTube: cada Super Chat que chega aparece inteiro por FEATURE_MS e depois vira só a pílula da fita.
 * Chegaram vários juntos: fila, o de maior valor primeiro, cada um com os seus FEATURE_MS. O histórico (o que a sala
 * manda ao entrar, que chega depois da tela montar) não é destacado de novo: só o que aparece com menos de HISTORY_MS.
 */
const HISTORY_MS = 15_000; // folga para relógio do aparelho diferente do servidor

function useFeatured(pins: ChatMsg[], now: number) {
  const seen = useRef(new Set<string>());
  const done = useRef(new Set<string>());
  const [cur, setCur] = useState<{ m: ChatMsg; until: number } | null>(null);
  useEffect(() => {
    for (const m of pins) {
      if (seen.current.has(m.id)) continue;
      seen.current.add(m.id);
      if (Date.now() - m.at > HISTORY_MS) done.current.add(m.id);
    }
    // tirado do ar pela moderação durante o destaque: some na hora
    if (cur && !pins.some((m) => m.id === cur.m.id)) return setCur(null);
    if (cur && now < cur.until) return;
    const next = pins.filter((m) => !done.current.has(m.id)).sort(byValue)[0];
    if (!next) return void (cur && setCur(null));
    done.current.add(next.id);
    setCur({ m: next, until: Date.now() + FEATURE_MS });
  }, [pins, now, cur]);
  return cur?.m ?? null;
}

/** fita de Super Chats fixados (o novo aparece inteiro por uns segundos); tocar numa pílula abre o cartão inteiro */
export function PinnedBar({ room, cands }: { room: Room; cands: CandidateDef[] | null }) {
  const { list, now, pins } = usePinned(room);
  const featured = useFeatured(pins, now);
  const [open, setOpen] = useState<string | null>(null);
  // a pílula do destacado só entra na fita quando ele recolhe
  const chips = list.filter((p) => p.m.id !== featured?.id);
  const opened = chips.find((p) => p.m.id === open)?.m;
  if (!chips.length && !featured) return null;
  return (
    <div className="relative">
      {chips.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto px-3 py-1.5 [scrollbar-width:none]" role="list" aria-label="Super Chats fixados">
          {chips.map(({ m, until }) => {
            const tier = scTier(m.sc ?? 0);
            const { bg, ink } = scColors(m, cands);
            const left = Math.max(0, Math.min(1, (until - now) / (tier.pin * 1000)));
            return (
              <button
                key={m.id}
                type="button"
                role="listitem"
                onClick={() => setOpen((o) => (o === m.id ? null : m.id))}
                className="press flex h-7 shrink-0 items-center gap-1.5 rounded-full pr-2.5 pl-1 text-[12px] font-semibold animate-in fade-in-0 zoom-in-90 duration-300"
                style={{
                  color: ink,
                  // a parte cheia é o tempo que ainda falta
                  background: `linear-gradient(90deg, ${bg} ${left * 100}%, color-mix(in oklab, ${bg} 55%, var(--card)) ${left * 100}%)`,
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
      )}
      {/* aberto pela pessoa vence o destaque automático */}
      {opened ? (
        <div className="absolute inset-x-0 top-full z-20 animate-in fade-in-0 slide-in-from-top-1 duration-150" onClick={() => setOpen(null)}>
          <SuperLine m={opened} cands={cands} className="shadow-[var(--shadow-card)]" />
        </div>
      ) : (
        featured && (
          <div
            key={featured.id}
            className="absolute inset-x-0 top-full z-20 animate-in fade-in-0 slide-in-from-top-2 duration-300"
            role="status"
            aria-live="polite"
          >
            <SuperLine m={featured} cands={cands} className="relative shadow-[var(--shadow-card)]" />
            {/* quanto falta para recolher */}
            <div
              className="mx-2 -mt-1.5 h-[3px] origin-left rounded-full bg-foreground/40"
              style={{ animation: `sc-feature ${FEATURE_MS}ms linear forwards` }}
              aria-hidden
            />
          </div>
        )
      )}
    </div>
  );
}
