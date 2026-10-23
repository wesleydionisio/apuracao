// Tela "Ao vivo": placar muito visível + chat na mesma tela, como uma live.
// Celular: tela única sem rolagem (o chat ocupa o resto). Desktop: placar à esquerda, chat fixo à direita.
import type { Board, Room } from '@apuracao/shared';
import { Users } from 'lucide-react';
import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Skeleton } from '@/components/ui';
import { LegalFooter } from '@/components/shell/bits';
import ChatView from '@/features/chat/ChatView';
import { useMountOnce } from '@/features/chat/lazy';
import { read, RoomBar, write } from '@/features/chat/rooms';
import { useKeyboardOpen, useMedia } from '@/features/watch/hooks';
import { LiveScore, LiveScoreCompact } from '@/features/watch/LiveScore';
import { MomentTicker } from '@/features/watch/MomentTicker';
import { PreLive } from '@/features/watch/PreLive';
import { fmtCompact } from '@/lib/format';
import { useBoard } from '@/store/board';

const MapCard = lazy(() => import('@/features/map/MapCard'));
const InfoDrawerLazy = lazy(() => import('@/features/chat/drawers').then((m) => ({ default: m.InfoDrawer })));

const LS_UF = 'chat:uf';
const LS_ROOM = 'chat:room';

function Watching() {
  const online = useBoard((s) => s.online);
  if (!online) return null;
  return (
    <span className="num flex shrink-0 items-center gap-1 text-[11.5px] text-muted-foreground" title="Pessoas acompanhando agora">
      <Users className="size-3.5" aria-hidden />
      <span className="font-semibold text-foreground">{fmtCompact(online)}</span>
    </span>
  );
}

/** Salas públicas (#brasil, #uf) com a escolha guardada no aparelho. */
function usePublicRoom(): [Room, ReactNode] {
  const [uf, setUf] = useState(() => read(LS_UF) ?? '');
  const [room, setRoom] = useState(() => read(LS_ROOM) ?? 'br');
  const bar = (
    <RoomBar
      room={room}
      uf={uf}
      onRoom={(r) => {
        setRoom(r);
        write(LS_ROOM, r);
      }}
      onUf={(u) => {
        setUf(u);
        write(LS_UF, u);
      }}
      right={<Watching />}
    />
  );
  return [room, bar];
}

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
    <LiveScore board={board} size={size} chartAlways={size === 'lg'} onInfo={onInfo} />
  ) : (
    <PreLive board={board} size={size} />
  );
}

/** Layout de live usado pela Home (#brasil/#uf) e pelas salas privadas. */
export function LiveScreen({ room, roomBar }: { room: Room; roomBar: ReactNode }) {
  const board = useBoard((s) => s.board);
  const loadError = useBoard((s) => s.loadError);
  const desktop = useMedia('(min-width: 1024px)');
  const kb = useKeyboardOpen();
  const [emoji, setEmoji] = useState(false);
  const [info, setInfo] = useState(false);

  const loading = !board ? (
    <div className="space-y-3 px-4 py-3" aria-busy="true">
      {loadError ? (
        <p className="text-[13px] text-muted-foreground">Não conseguimos carregar o placar. Tentando de novo…</p>
      ) : (
        <>
          <Skeleton h={88} />
          <Skeleton h={12} />
        </>
      )}
    </div>
  ) : null;

  if (desktop) {
    return (
      <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <div className="overflow-hidden rounded-2xl border bg-card">
            <div className="p-6">{board ? <ScoreBlock board={board} size="lg" onInfo={() => setInfo(true)} /> : loading}</div>
            {board && <MomentTicker board={board} />}
          </div>
          {board?.released && (
            <Suspense fallback={<Skeleton h={300} />}>
              <MapCard />
            </Suspense>
          )}
          <LegalFooter />
        </div>
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

  const top = !board ? (
    loading
  ) : kb || emoji ? (
    <LiveScoreCompact board={board} />
  ) : (
    <>
      <ScoreBlock board={board} size="md" onInfo={() => setInfo(true)} />
      <MomentTicker board={board} />
    </>
  );
  return (
    <>
      <ChatView key={room} room={room} layout="shell" top={<div className="border-b">{top}</div>} roomBar={roomBar} onEmojiOpen={setEmoji} />
      <InfoDrawer open={info} onOpenChange={setInfo} />
    </>
  );
}

export default function Home() {
  const [room, bar] = usePublicRoom();
  return <LiveScreen room={room} roomBar={bar} />;
}
