// O chat agora vive na tela Ao vivo (/). /chat redireciona; /sala/:slug usa o mesmo layout de live.
import { ArrowLeft, Lock, UserPlus } from 'lucide-react';
import { Link, Redirect, useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui';
import { inviteShare, read } from '@/features/chat/rooms';
import { prefetchImage, share } from '@/lib/share';
import { LiveScreen } from './Home';

/** apelido escolhido neste aparelho (o servidor dá um padrão estável) */
export function savedNick() {
  return read('nick');
}

export default function ChatPage() {
  return <Redirect to="/" replace />;
}

export function SalaPage() {
  const { slug } = useParams<{ slug: string }>();
  const safe = (slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  const name = safe.length >= 3 ? safe : `${safe}xxx`.slice(0, 3);
  const room = `sala:${name}`;
  const bar = (
    <div className="flex items-center gap-2 px-2 py-1.5">
      <Button asChild variant="ghost" size="icon" className="size-8 shrink-0 rounded-full" aria-label="Voltar para #brasil">
        <Link href="/">
          <ArrowLeft className="size-4" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Lock className="size-3.5 text-muted-foreground" aria-hidden />
          <span className="truncate">Sala {name}</span>
        </div>
        <div className="text-[11px] text-muted-foreground">Privada · só entra quem tem o link</div>
      </div>
      <Button
        size="sm"
        className="h-8 shrink-0 rounded-full px-3 text-[12.5px]"
        onPointerDown={() => prefetchImage()}
        onClick={async () => {
          const r = await share(inviteShare(name));
          if (r === 'copied') toast('Link da sala copiado — cole no grupo');
          else if (r === 'failed') toast('Não deu para compartilhar daqui');
        }}
      >
        <UserPlus className="size-3.5" aria-hidden />
        Convidar
      </Button>
    </div>
  );
  return <LiveScreen room={room} roomBar={bar} />;
}
