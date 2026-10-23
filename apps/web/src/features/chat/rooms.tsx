// Salas (#brasil, estado, privadas) e identidade (apelido).
import { UFS } from '@apuracao/shared';
import { Check, Link2, Lock, MapPin, Pencil, Plus, Users } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { share } from '@/lib/share';
import { live } from '@/lib/live';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { toast } from '@/components/ui';

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

const UF_LIST = Object.entries(UFS).filter(([k]) => k !== 'ZZ');

function Pill({ on, onClick, children, label }: { on?: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      className={cn(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150 active:scale-[0.97]',
        on ? 'bg-foreground text-background' : 'border bg-card text-foreground hover:bg-accent',
      )}
    >
      {children}
    </button>
  );
}

/** pílulas roláveis: #brasil · #uf · Estado · Amigos */
export function RoomBar({
  room,
  uf,
  onRoom,
  onUf,
}: {
  room: string;
  uf: string;
  onRoom: (r: string) => void;
  onUf: (uf: string) => void;
}) {
  const [ufOpen, setUfOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const ufRoom = uf.toLowerCase();
  return (
    <div className="flex items-center gap-2 overflow-x-auto px-3 py-2 no-scrollbar">
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
        {uf ? 'Trocar estado' : 'Seu estado'}
      </Pill>
      <Pill onClick={() => setInviteOpen(true)}>
        <Users className="size-3.5" aria-hidden />
        Sala com amigos
      </Pill>

      <Drawer open={ufOpen} onOpenChange={setUfOpen}>
        <DrawerContent className="mx-auto max-w-lg">
          <DrawerHeader className="text-left">
            <DrawerTitle>Sala do seu estado</DrawerTitle>
            <DrawerDescription>Converse com quem está acompanhando a apuração no mesmo estado.</DrawerDescription>
          </DrawerHeader>
          <div className="grid grid-cols-3 gap-1.5 overflow-y-auto px-4 pb-6">
            {UF_LIST.map(([k, name]) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  onUf(k);
                  onRoom(k.toLowerCase());
                  setUfOpen(false);
                }}
                className={cn(
                  'flex min-h-12 flex-col items-start justify-center rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-accent',
                  uf === k && 'border-foreground bg-accent',
                )}
              >
                <span className="text-[13px] font-semibold">{k}</span>
                <span className="w-full truncate text-[11px] text-muted-foreground">{name}</span>
              </button>
            ))}
          </div>
        </DrawerContent>
      </Drawer>

      <InviteDrawer open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

const newSlug = () => Math.random().toString(36).slice(2, 8);

export function inviteShare(slug: string) {
  return {
    title: 'Vem acompanhar a apuração comigo',
    text: 'Entra na minha sala para acompanhar a apuração do 2º turno ao vivo:',
    url: `/sala/${slug}`,
  };
}

function InviteDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [, nav] = useLocation();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="text-left">
          <DrawerTitle>Sala com amigos</DrawerTitle>
          <DrawerDescription>
            Uma sala privada para assistir junto: só entra quem tiver o link. O placar continua ao vivo no topo.
          </DrawerDescription>
        </DrawerHeader>
        <ul className="space-y-2 px-4 pb-2 text-[13px] text-muted-foreground">
          <li className="flex items-center gap-2">
            <Lock className="size-4 shrink-0" aria-hidden /> Fora da lista pública de salas
          </li>
          <li className="flex items-center gap-2">
            <Link2 className="size-4 shrink-0" aria-hidden /> Mande o link no grupo do WhatsApp
          </li>
        </ul>
        <DrawerFooter>
          <Button
            size="lg"
            className="h-12 rounded-xl text-[15px]"
            onClick={async () => {
              const slug = newSlug();
              onOpenChange(false);
              nav(`/sala/${slug}`);
              const r = await share(inviteShare(slug));
              if (r === 'copied') toast('Link da sala copiado — cole no grupo');
            }}
          >
            <Plus className="size-4" aria-hidden />
            Criar sala e convidar
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost" className="h-11">
              Agora não
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/** Troca de apelido: vale para o chat agora e é reenviado a cada reconexão. */
export function NickDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const me = useBoard((s) => s.me);
  const [v, setV] = useState('');
  const clean = v.trim().replace(/\s+/g, ' ');
  const ok = clean.length >= 2 && clean.length <= 24;
  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        if (o) setV(me?.nick ?? '');
        onOpenChange(o);
      }}
    >
      <DrawerContent className="mx-auto max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok || !me) return;
            write('nick', clean);
            live.nick(clean);
            useBoard.getState().set({ me: { ...me, nick: clean } });
            onOpenChange(false);
            toast('Apelido atualizado');
          }}
        >
          <DrawerHeader className="text-left">
            <DrawerTitle>Seu apelido</DrawerTitle>
            <DrawerDescription>Aparece no chat e no card do palpite. Não precisa ser seu nome real.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4">
            <Input
              value={v}
              onChange={(e) => setV(e.target.value.slice(0, 24))}
              maxLength={24}
              autoFocus
              autoComplete="nickname"
              aria-label="Apelido"
              className="h-12 rounded-xl text-base"
            />
            <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
              <span>2 a 24 caracteres, sem links ou ofensas</span>
              <span className="num">{clean.length}/24</span>
            </div>
          </div>
          <DrawerFooter>
            <Button type="submit" size="lg" disabled={!ok} className="h-12 rounded-xl text-[15px]">
              <Check className="size-4" aria-hidden />
              Salvar apelido
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export function NickButton({ onClick }: { onClick: () => void }) {
  const me = useBoard((s) => s.me);
  if (!me) return null;
  return (
    <button type="button" onClick={onClick} className="inline-flex min-h-6 items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline">
      {me.nick}
      <Pencil className="size-3 text-muted-foreground" aria-hidden />
      <span className="sr-only">editar apelido</span>
    </button>
  );
}
