// Aba Chat (celular): o chat #brasil em tela cheia, fixo entre o cabeçalho e as abas, com só o essencial do
// placar no topo (candidatos, votos, % apurado e a barra). Digitando ou com os emojis abertos, o placar vira uma linha.
// No desktop o chat já fica ao lado do placar na tela Ao vivo: /chat volta para lá. Links antigos de sala (/sala/:slug) também.
import { useEffect, useState } from 'react';
import { Redirect } from 'wouter';
import { LoadState } from '@/components/ui';
import ChatView from '@/features/chat/ChatView';
import { read, RoomBar, Watching } from '@/features/chat/rooms';
import { useKeyboardOpen, useMedia } from '@/features/watch/hooks';
import { zeroBoard } from '@/features/watch/data';
import { LiveScoreCompact, LiveScoreEssential } from '@/features/watch/LiveScore';
import { ghostBoard } from '@/lib/ghost';
import { useBoard } from '@/store/board';

/** apelido escolhido neste aparelho (o servidor dá um padrão estável) */
export function savedNick() {
  return read('nick');
}

export default function ChatPage() {
  const desktop = useMedia('(min-width: 1024px)');
  const board = useBoard((s) => s.board);
  const loadError = useBoard((s) => s.loadError);
  const kb = useKeyboardOpen();
  const [emoji, setEmoji] = useState(false);
  // o chat fica fixo sobre a página: a página por baixo não pode rolar (no iOS o gesto passava para ela e
  // arrastava o chat junto). Só a lista de mensagens rola.
  useEffect(() => {
    if (desktop) return;
    const html = document.documentElement;
    html.classList.add('chat-lock');
    return () => html.classList.remove('chat-lock');
  }, [desktop]);
  if (desktop) return <Redirect to="/" replace />;

  const top = !board ? (
    // fantasma do mesmo placar essencial: o chat embaixo não sobe nem desce quando o dado chega
    <div className="relative" aria-busy="true">
      <div className="ghost" aria-hidden>
        {kb || emoji ? <LiveScoreCompact board={ghostBoard()} /> : <LiveScoreEssential board={ghostBoard()} />}
      </div>
      <LoadState error={loadError} />
    </div>
  ) : kb || emoji ? (
    <LiveScoreCompact board={zeroBoard(board)} />
  ) : (
    // compacto: antes das 17h a contagem entre os candidatos; depois os %, a barra e o apurado
    <LiveScoreEssential board={board} />
  );
  return <ChatView room="br" layout="shell" top={<div className="border-b">{top}</div>} roomBar={<RoomBar compact right={<Watching />} />} onEmojiOpen={setEmoji} />;
}

export function SalaPage() {
  return <Redirect to="/" replace />;
}
