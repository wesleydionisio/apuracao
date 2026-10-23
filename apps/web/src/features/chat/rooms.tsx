// Topo do chat (só #brasil) e utilidades de armazenamento local do chat.
import type { ReactNode } from 'react';

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

/** topo do chat: a sala (#brasil) e, na ponta, quantos assistem */
export function RoomBar({ right }: { right?: ReactNode }) {
  return (
    <div className="flex h-11 items-center justify-between gap-2 px-4">
      <span className="flex items-center gap-2 text-[14px] font-semibold">
        <span className="relative flex size-2" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-red-500" />
        </span>
        Chat ao vivo
        <span className="font-medium text-muted-foreground">#brasil</span>
      </span>
      {right}
    </div>
  );
}
