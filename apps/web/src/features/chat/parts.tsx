// Peças do chat: mini-placar, mensagens (usuário e sistema), reações.
import type { CandidateDef, ChatMsg, Reaction, Room } from '@apuracao/shared';
import { EMOJI_REACTIONS as REACTIONS } from '@apuracao/shared';
import { useEffect, useState } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { fmtHM } from '@/lib/format';
import { live } from '@/lib/live';
import { cn } from '@/lib/utils';
import { mentioned, momentParts } from '@/features/standalone/bits';

/** inicial do apelido sobre a cor estável do autor */
export function NickAvatar({ m, className }: { m: Pick<ChatMsg, 'nick' | 'hue'>; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold text-white', className)}
      style={{ background: `hsl(${m.hue} 45% 44%)` }}
    >
      {m.nick.charAt(0).toUpperCase()}
    </span>
  );
}

/** cor do apelido: mais escura no claro, mais clara no escuro (contraste AA nos dois) */
export const nickColor = (hue: number) => ({ ['--h' as string]: hue }) as React.CSSProperties;
export const NICK_CLS = 'text-[hsl(var(--h)_55%_36%)] dark:text-[hsl(var(--h)_70%_70%)]';

/** Momento da apuração dentro do chat: cartão com os candidatos citados. */
export function SystemMessage({ m, cands }: { m: ChatMsg; cands: CandidateDef[] | null }) {
  const { Icon, kind, text } = momentParts(m.body);
  const who = mentioned(cands, text).slice(0, 2);
  return (
    <div className="my-2 flex items-start gap-3 rounded-xl border bg-card px-3 py-2.5">
      {who.length ? (
        <span className="relative mt-0.5 flex shrink-0">
          <span className="flex -space-x-2">
            {who.map((c) => (
              <CandidateAvatar key={c.key} c={c} size="sm" className="ring-2 ring-card" />
            ))}
          </span>
          <span className="absolute -right-1.5 -bottom-1 flex size-4 items-center justify-center rounded-full bg-foreground text-background ring-2 ring-card">
            <Icon className="size-2.5" aria-hidden />
          </span>
        </span>
      ) : (
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
          <Icon className="size-4" aria-hidden />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{kind}</span>
          <span aria-hidden>·</span>
          <span className="num">{fmtHM(new Date(m.at).toISOString())}</span>
        </div>
        <p className="mt-0.5 text-[14px] leading-snug font-medium text-pretty">{text}</p>
      </div>
    </div>
  );
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil` : String(n);

/** Reações agregadas (no máx. 1 atualização/s do servidor) + emoji subindo quando chega uma rajada. */
export function Reactions({
  room,
  reacts,
  burst,
  disabled,
}: {
  room: Room;
  reacts?: Partial<Record<Reaction, number>>;
  burst?: { e: Reaction; n: number; k: number };
  disabled: boolean;
}) {
  const [floats, setFloats] = useState<{ k: number; e: string; x: number }[]>([]);
  const [tapped, setTapped] = useState<string | null>(null);
  useEffect(() => {
    if (!burst) return;
    const f = { k: burst.k, e: burst.e, x: 8 + Math.random() * 84 };
    setFloats((cur) => [...cur.slice(-6), f]);
    const t = setTimeout(() => setFloats((cur) => cur.filter((x) => x.k !== f.k)), 1300);
    return () => clearTimeout(t);
  }, [burst]);
  return (
    <div className="relative flex gap-1.5 overflow-x-auto px-3 py-2 no-scrollbar">
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-0" aria-hidden>
        {floats.map((f) => (
          <span key={f.k} className="float-emoji absolute bottom-0 text-2xl" style={{ left: `${f.x}%` }}>
            {f.e}
          </span>
        ))}
      </div>
      {REACTIONS.map((e) => {
        const n = reacts?.[e] ?? 0;
        return (
          <button
            key={e}
            type="button"
            disabled={disabled}
            onClick={() => {
              live.react(room, e);
              navigator.vibrate?.(8);
              setTapped(e);
              setTimeout(() => setTapped((t) => (t === e ? null : t)), 180);
            }}
            className={cn(
              'flex h-9 min-w-[3.25rem] flex-1 items-center justify-center gap-1.5 rounded-full border bg-card px-2.5 transition-transform duration-150 ease-out active:scale-95 disabled:opacity-40',
              tapped === e && 'scale-110',
            )}
            aria-label={`Reagir com ${e}${n ? `, ${n} reações` : ''}`}
          >
            <span className="text-[17px] leading-none">{e}</span>
            {n > 0 && <span className="num text-[11px] font-medium text-muted-foreground">{compact(n)}</span>}
          </button>
        );
      })}
    </div>
  );
}
