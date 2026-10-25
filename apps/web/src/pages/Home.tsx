// Tela "Ao vivo". Desktop: placar à esquerda, chat fixo à direita, como uma live.
// Celular: só as informações (placar, curva, marcos, mapa); o chat tem a aba própria (/chat), com o essencial do placar no topo.
import type { Board, Room } from '@apuracao/shared';
import { ChevronRight } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { LoadState, MapCardSkeleton } from '@/components/ui';
import { LegalFooter } from '@/components/shell/bits';
import ChatView from '@/features/chat/ChatView';
import { useMountOnce } from '@/features/chat/lazy';
import { GuessCta } from '@/features/guess/GuessCta';
import { RoomBar, Watching } from '@/features/chat/rooms';
import { useMedia } from '@/features/watch/hooks';
import { LiveScore } from '@/features/watch/LiveScore';
import { MomentTicker } from '@/features/watch/MomentTicker';
import { PreLive } from '@/features/watch/PreLive';
import { fmtCompact } from '@/lib/format';
import { ghostBoard } from '@/lib/ghost';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';

const MapCard = lazy(() => import('@/features/map/MapCard'));
const InfoDrawerLazy = lazy(() => import('@/features/chat/drawers').then((m) => ({ default: m.InfoDrawer })));

function InfoDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const mounted = useMountOnce(open);
  return mounted ? (
    <Suspense fallback={null}>
      <InfoDrawerLazy open={open} onOpenChange={onOpenChange} />
    </Suspense>
  ) : null;
}

function ScoreBlock({ board, size, onInfo }: { board: Board; size: 'md' | 'lg'; onInfo: () => void }) {
  return board.released && board.br ? (
    <LiveScore board={board} size={size} chartAlways onInfo={onInfo} />
  ) : (
    <PreLive board={board} size={size} />
  );
}

/** Celular: atalho para a aba Chat, com quantos acompanham agora. */
function ChatEntry() {
  const online = useBoard((s) => s.online);
  return (
    <Link href="/chat" className="flex items-center gap-3 rounded-2xl border bg-card px-4 py-3.5 transition-colors hover:bg-accent/50 active:bg-accent">
      <span className="relative flex size-2 shrink-0" aria-hidden>
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-red-500" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-semibold">
          Chat ao vivo <span className="font-medium text-muted-foreground">#brasil</span>
        </span>
        <span className="num mt-0.5 block truncate text-[12.5px] text-muted-foreground">
          {online ? `${fmtCompact(online)} pessoas acompanhando agora` : 'Comente a apuração com todo mundo'}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}

/** Layout de live usado pela Home (#brasil). */
export function LiveScreen({ room, roomBar }: { room: Room; roomBar: ReactNode }) {
  const board = useBoard((s) => s.board);
  const loadError = useBoard((s) => s.loadError);
  const desktop = useMedia('(min-width: 1024px)');
  const [info, setInfo] = useState(false);

  // sem placar ainda: o próprio placar com dados fantasma (mesmo tamanho), e o aviso de erro por cima, sem empurrar nada
  const shown = board ?? ghostBoard();

  const content = (
    <>
      {/* celular: placar de ponta a ponta (no cartão os nomes não cabem ao lado das fotos) */}
      <div className={cn('relative', desktop ? 'overflow-hidden rounded-2xl border bg-card' : '-mx-4 -mt-1 border-b')} aria-busy={!board || undefined}>
        <div className={cn(!board && 'ghost')} aria-hidden={!board || undefined}>
          <div className={desktop ? 'p-6' : 'pb-1'}>
            <ScoreBlock board={shown} size={desktop ? 'lg' : 'md'} onInfo={() => setInfo(true)} />
          </div>
          <MomentTicker board={shown} />
        </div>
        {!board && <LoadState error={loadError} />}
      </div>
      {board && <GuessCta board={board} />}
      {!desktop && <ChatEntry />}
      {/* antes das 19h o mapa mostra o 1º turno: o site já aparece inteiro */}
      {board && (
        <Suspense fallback={<MapCardSkeleton />}>
          <MapCard />
        </Suspense>
      )}
      <LegalFooter />
    </>
  );

  if (!desktop) {
    return (
      <div className="space-y-4 pt-1">
        {content}
        <InfoDrawer open={info} onOpenChange={setInfo} />
      </div>
    );
  }

  return (
    <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-4">{content}</div>
      <div
        className="sticky self-start"
        style={{ top: 'calc(var(--header-total, 56px) + 12px)', height: 'calc(100dvh - var(--header-total, 56px) - var(--tabbar-total) - 28px)' }}
      >
        <ChatView key={room} room={room} layout="panel" roomBar={roomBar} />
      </div>
      <InfoDrawer open={info} onOpenChange={setInfo} />
    </div>
  );
}

export default function Home() {
  return <LiveScreen room="br" roomBar={<RoomBar right={<Watching />} />} />;
}
