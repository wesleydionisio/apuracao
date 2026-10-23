// Painel de emoji embutido acima do composer (como o teclado de emoji de um app de mensagens):
// não usa portal, então o input continua focado e o teclado virtual não fecha.
import type { CandidateDef } from '@apuracao/shared';
import { cn } from '@/lib/utils';
import { PartyBadge } from './parts';
import { read, write } from './rooms';

/** curadoria para noite de apuração: tensão, alívio, festa, números */
export const EMOJIS = [
  '🔥', '😱', '👏', '😂', '👀', '🙏', '😬', '🤯', '🥳', '😭', '💪', '🇧🇷',
  '🗳️', '📈', '📉', '⏳', '✅', '❌', '🤞', '🫣', '😮‍💨', '🎉', '😤', '🤔',
  '😅', '🥲', '😎', '🤡', '💥', '⚡', '🚀', '🐢', '🍿', '☕', '📺', '🧮',
  '🎯', '🫡', '❤️', '💙',
];

const LS = 'emoji:recent';

export function recentEmojis(): string[] {
  try {
    const v = JSON.parse(read(LS) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function remember(token: string) {
  write(LS, JSON.stringify([token, ...recentEmojis().filter((x) => x !== token)].slice(0, 8)));
}

/** pointerdown + preventDefault: o toque não tira o foco do input */
const keepFocus = (e: React.PointerEvent) => e.preventDefault();

export function EmojiPanel({
  cands,
  onPick,
  className,
}: {
  cands: [CandidateDef, CandidateDef] | null;
  onPick: (text: string) => void;
  className?: string;
}) {
  const recents = recentEmojis();
  const pick = (t: string) => {
    remember(t);
    onPick(t);
  };
  const tokenOf = (c: CandidateDef) => `:${c.n}:`;
  const label = (t: string) => {
    const c = cands?.find((x) => tokenOf(x) === t);
    return c ? <PartyBadge c={c} party size="md" /> : <span className="text-[22px] leading-none">{t}</span>;
  };
  return (
    <div className={cn('border-t bg-background', className)} role="dialog" aria-label="Emojis">
      {cands && (
        <div className="flex items-center gap-2 px-3 pt-2.5">
          <span className="text-[11px] font-medium text-muted-foreground">Torcida</span>
          {cands.map((c) => (
            <button
              key={c.key}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => pick(tokenOf(c))}
              className="press rounded-md p-0.5"
              aria-label={`Inserir selo ${c.n} ${c.party ?? ''}`}
            >
              <PartyBadge c={c} party size="md" />
            </button>
          ))}
        </div>
      )}
      {recents.length > 0 && (
        <div className="flex items-center gap-1 overflow-x-auto px-2 pt-2 no-scrollbar">
          <span className="shrink-0 px-1 text-[11px] font-medium text-muted-foreground">Recentes</span>
          {recents.map((t) => (
            <button
              key={t}
              type="button"
              onPointerDown={keepFocus}
              onClick={() => pick(t)}
              className="flex size-10 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-accent active:bg-accent"
              aria-label={`Inserir ${t}`}
            >
              {label(t)}
            </button>
          ))}
        </div>
      )}
      <div className="grid max-h-[168px] grid-cols-8 gap-0.5 overflow-y-auto px-2 pt-1.5 pb-2 sm:grid-cols-10">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            onPointerDown={keepFocus}
            onClick={() => pick(e)}
            className="flex aspect-square items-center justify-center rounded-lg text-[24px] leading-none transition-transform duration-100 hover:bg-accent active:scale-90"
            aria-label={`Inserir ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
