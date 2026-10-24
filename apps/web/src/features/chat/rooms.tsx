// Topo do chat (só #brasil) e utilidades de armazenamento local do chat.
import { Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { fmtCompact } from '@/lib/format';
import { useBoard } from '@/store/board';

export const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
export const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem storage */
  }
};

/**
 * Topo do chat: a sala (#brasil) e, na ponta, quantos assistem.
 * `compact` (celular): só "#brasil" e o contador, sem padding próprio, para dividir a linha com a torcida.
 */
export function RoomBar({ right, compact = false }: { right?: ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? 'flex min-w-0 items-center gap-2.5' : 'flex h-11 items-center justify-between gap-2 px-4'}>
      <span className="flex items-center gap-2 text-[14px] font-semibold">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
        {compact ? <span className="sr-only">Chat ao vivo</span> : 'Chat ao vivo'}
        <span className={compact ? '' : 'font-medium text-muted-foreground'}>#brasil</span>
      </span>
      {right}
    </div>
  );
}

/** quantas pessoas acompanham agora (todo o site) */
export function Watching() {
  const online = useBoard((s) => s.online);
  if (!online) return null;
  return (
    <span className="num flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground" title="Pessoas acompanhando agora">
      <Users className="size-3.5" aria-hidden />
      <span className="font-semibold text-foreground">{fmtCompact(online)}</span>
    </span>
  );
}
