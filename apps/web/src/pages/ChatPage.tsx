import { ArrowLeft, Lock, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import ChatView from '@/features/chat/ChatView';
import { inviteShare, read, RoomBar, write } from '@/features/chat/rooms';
import { prefetchImage, share } from '@/lib/share';

const LS_UF = 'chat:uf';
const LS_ROOM = 'chat:room';

/** apelido escolhido neste aparelho (o servidor dá um padrão estável) */
export function savedNick() {
  return read('nick');
}

export default function ChatPage() {
  const [uf, setUf] = useState(() => read(LS_UF) ?? '');
  const [room, setRoom] = useState(() => read(LS_ROOM) ?? 'br');
  const pick = (r: string) => {
    setRoom(r);
    write(LS_ROOM, r);
  };
  return (
    <ChatView
      key={room}
      room={room}
      top={
        <RoomBar
          room={room}
          uf={uf}
          onRoom={pick}
          onUf={(u) => {
            setUf(u);
            write(LS_UF, u);
          }}
        />
      }
    />
  );
}

export function SalaPage() {
  const { slug } = useParams<{ slug: string }>();
  const safe = (slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  const name = safe.length >= 3 ? safe : `${safe}xxx`.slice(0, 3);
  const room = `sala:${name}`;
  const top = (
    <div className="flex items-center gap-3 px-3 py-2">
      <Button asChild variant="ghost" size="icon" className="size-9 shrink-0 rounded-full" aria-label="Voltar para #brasil">
        <Link href="/chat">
          <ArrowLeft className="size-4" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[14px] font-semibold">
          <Lock className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="truncate">Sala {name}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">Privada · só entra quem tem o link</div>
      </div>
      <Button
        size="sm"
        className="h-9 shrink-0 rounded-full px-3.5"
        onPointerDown={() => prefetchImage()}
        onClick={async () => {
          const r = await share(inviteShare(name));
          if (r === 'copied') toast('Link da sala copiado — cole no grupo');
          else if (r === 'failed') toast('Não deu para compartilhar daqui');
        }}
      >
        <UserPlus className="size-4" aria-hidden />
        Convidar
      </Button>
    </div>
  );
  return <ChatView key={room} room={room} top={top} />;
}
