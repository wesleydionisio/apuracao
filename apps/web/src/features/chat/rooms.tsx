// Salas (#brasil, estado, privadas) e utilidades de armazenamento local do chat.
import { MapPin, Users } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useMountOnce } from './lazy';

// gavetas (vaul) fora do bundle inicial: carregam no primeiro toque
const UfDrawer = lazy(() => import('./drawers').then((m) => ({ default: m.UfDrawer })));
const InviteDrawer = lazy(() => import('./drawers').then((m) => ({ default: m.InviteDrawer })));

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

function Pill({ on, onClick, children, label }: { on?: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-150 active:scale-[0.97]',
        on ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

/** pílulas roláveis: #brasil · #uf · Estado · Amigos; `right` fica fixo na ponta (ex.: quantos assistem) */
export function RoomBar({
  room,
  uf,
  onRoom,
  onUf,
  right,
}: {
  room: string;
  uf: string;
  onRoom: (r: string) => void;
  onUf: (uf: string) => void;
  right?: ReactNode;
}) {
  const [ufOpen, setUfOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const ufMounted = useMountOnce(ufOpen);
  const inviteMounted = useMountOnce(inviteOpen);
  const ufRoom = uf.toLowerCase();
  return (
    <div className="flex items-center gap-1 pr-3">
      <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1.5 pl-2 no-scrollbar">
        <Pill on={room === 'br'} onClick={() => onRoom('br')}>
          #brasil
        </Pill>
        {uf && (
          <Pill on={room === ufRoom} onClick={() => onRoom(ufRoom)}>
            #{ufRoom}
          </Pill>
        )}
        <Pill onClick={() => setUfOpen(true)} label={uf ? 'Trocar sala do estado' : 'Escolher sala do seu estado'}>
          <MapPin className="size-3.5" aria-hidden />
          {uf ? 'Estado' : 'Seu estado'}
        </Pill>
        <Pill onClick={() => setInviteOpen(true)} label="Criar sala privada com amigos">
          <Users className="size-3.5" aria-hidden />
          Amigos
        </Pill>
      </div>
      {right}
      <Suspense fallback={null}>
        {ufMounted && (
          <UfDrawer
            open={ufOpen}
            onOpenChange={setUfOpen}
            uf={uf}
            onPick={(k) => {
              onUf(k);
              onRoom(k.toLowerCase());
            }}
          />
        )}
        {inviteMounted && <InviteDrawer open={inviteOpen} onOpenChange={setInviteOpen} />}
      </Suspense>
    </div>
  );
}

export function inviteShare(slug: string) {
  return {
    title: 'Vem acompanhar a apuração comigo',
    text: 'Entra na minha sala para acompanhar a apuração do 2º turno ao vivo:',
    url: `/sala/${slug}`,
  };
}
