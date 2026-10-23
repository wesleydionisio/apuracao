// O chat vive na tela Ao vivo (/), só na sala #brasil. /chat e os links antigos de sala privada (/sala/:slug) redirecionam.
import { Redirect } from 'wouter';
import { read } from '@/features/chat/rooms';

/** apelido escolhido neste aparelho (o servidor dá um padrão estável) */
export function savedNick() {
  return read('nick');
}

export default function ChatPage() {
  return <Redirect to="/" replace />;
}

export function SalaPage() {
  return <Redirect to="/" replace />;
}
