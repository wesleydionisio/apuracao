// Chat em tela cheia, pensado para teclado virtual no celular (html.kb / .chat-shell no index.css).
import type { ChatMsg, Room } from '@apuracao/shared';
import { MAX_BODY } from '@apuracao/shared';
import { ArrowDown, Copy, Flag, SendHorizontal, WifiOff } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCandidates } from '@/components/core/candidate';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { toast } from '@/components/ui';
import { fmtHM } from '@/lib/format';
import { live } from '@/lib/live';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { useChat } from '@/store/chat';
import { NICK_CLS, NickAvatar, nickColor, Reactions, SystemMessage } from './parts';
import { NickButton, NickDrawer } from './rooms';

const EMPTY: ChatMsg[] = [];
/** mensagens do mesmo autor em até 2 min viram um bloco só */
const GROUP_MS = 120_000;

const ERR_TEXT: Record<string, string> = {
  rate: 'Devagar: espere um pouco para mandar outra.',
  slow: 'Modo lento ligado nesta sala.',
  blocked: 'Mensagem bloqueada: sem links, ofensas ou ameaças.',
  closed: 'Esta sala foi fechada pela moderação.',
  invalid: 'Mensagem inválida (até 240 caracteres).',
  off: 'O chat está desligado no momento.',
};

interface Row {
  m: ChatMsg;
  head: boolean;
}

function rowsOf(msgs: ChatMsg[]): Row[] {
  return msgs.map((m, i) => {
    const p = msgs[i - 1];
    const head = !p || !!p.sys || !!m.sys || p.nick !== m.nick || p.hue !== m.hue || m.at - p.at > GROUP_MS;
    return { m, head };
  });
}

export default function ChatView({ room, top }: { room: Room; top?: ReactNode }) {
  const msgs = useChat((s) => s.msgs[room] ?? EMPTY);
  const reacts = useChat((s) => s.reacts[room]);
  const burst = useChat((s) => s.burst[room]);
  const slow = useChat((s) => s.slow[room] ?? 0);
  const err = useChat((s) => s.err[room]);
  const enabled = useChat((s) => s.enabled);
  const closed = useChat((s) => s.closed.includes(room));
  const link = useBoard((s) => s.link);
  const me = useBoard((s) => s.me);
  const cands = useCandidates();
  const [text, setText] = useState('');
  const [cool, setCool] = useState(0);
  const [picked, setPicked] = useState<ChatMsg | null>(null);
  const [nickOpen, setNickOpen] = useState(false);
  const [stuck, setStuck] = useState(true);
  const [unseen, setUnseen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const lastLen = useRef(msgs.length);
  const rows = useMemo(() => rowsOf(msgs), [msgs]);

  useEffect(() => {
    live.join(room);
    return () => live.leave(room);
  }, [room]);

  // cola no fim quando chega mensagem, se o usuário já estava no fim; senão conta as novas
  useLayoutEffect(() => {
    const el = listRef.current;
    const added = Math.max(0, msgs.length - lastLen.current);
    lastLen.current = msgs.length;
    if (!el) return;
    if (stuck) el.scrollTop = el.scrollHeight;
    else if (added) setUnseen((n) => n + added);
  }, [msgs, stuck]);

  useEffect(() => {
    if (!cool) return;
    const t = setTimeout(() => setCool((c) => Math.max(0, c - 1)), 1000);
    return () => clearTimeout(t);
  }, [cool]);

  useEffect(() => {
    if (err?.wait) setCool(Math.ceil(err.wait));
  }, [err]);

  const degraded = link !== 'live' && link !== 'demo';
  const disabled = degraded || !enabled || closed;

  function jumpToEnd() {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setStuck(true);
    setUnseen(0);
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || disabled || cool) return;
    if (live.chat(room, body)) {
      setText('');
      setStuck(true);
      setUnseen(0);
      useChat.getState().setErr(room, undefined);
      if (slow) setCool(slow);
    }
  }

  const errText = err && Date.now() - err.at < 8000 ? (ERR_TEXT[err.code] ?? 'Não foi possível enviar.') : null;
  const placeholder = disabled ? 'Chat indisponível agora' : cool ? `Aguarde ${cool}s para a próxima` : 'Comente a apuração…';

  return (
    <div className="chat-shell fixed inset-x-0 z-20 mx-auto flex max-w-3xl flex-col bg-background lg:border-x">
      {top}
      {disabled && (
        <div className="flex items-center gap-2 border-y bg-muted px-4 py-2 text-[12px] text-muted-foreground" role="status">
          <WifiOff className="size-3.5 shrink-0" aria-hidden />
          {closed
            ? 'Esta sala foi fechada pela moderação.'
            : !enabled
              ? 'Chat desligado no momento. O placar segue ao vivo.'
              : 'Reconectando o chat… o placar continua atualizando normalmente.'}
        </div>
      )}
      {slow > 0 && !disabled && (
        <div className="border-y bg-muted/60 px-4 py-1.5 text-[12px] text-muted-foreground" role="status">
          Modo lento: 1 mensagem a cada <span className="num font-medium text-foreground">{slow}s</span> por pessoa
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 64;
            setStuck(atEnd);
            if (atEnd) setUnseen(0);
          }}
          className="h-full overflow-y-auto overscroll-contain px-3 pt-2 pb-3"
          role="log"
          aria-label="Mensagens"
        >
          {!msgs.length && (
            <div className="flex h-full flex-col items-center justify-center px-8 text-center">
              <p className="text-[15px] font-medium">{disabled ? 'Sem mensagens por enquanto' : 'Ninguém comentou ainda'}</p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {disabled ? 'Assim que o chat voltar, as mensagens aparecem aqui.' : 'Viradas e marcos da apuração também aparecem aqui, em tempo real.'}
              </p>
            </div>
          )}
          {rows.map(({ m, head }) =>
            m.sys ? (
              <SystemMessage key={m.id} m={m} cands={cands} />
            ) : (
              <button
                key={m.id}
                type="button"
                onClick={() => setPicked(m)}
                className={cn(
                  'group flex w-full gap-2.5 rounded-lg px-1 text-left transition-colors hover:bg-accent/50 active:bg-accent',
                  head ? 'mt-2 pt-1' : 'pt-0.5',
                )}
                aria-label={`${m.nick}: ${m.body}. Toque para opções`}
              >
                {head ? <NickAvatar m={m} className="mt-0.5" /> : <span className="w-7 shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1">
                  {head && (
                    <span className="flex items-baseline gap-2">
                      <span className={cn('truncate text-[13px] font-semibold', NICK_CLS)} style={nickColor(m.hue)}>
                        {m.nick}
                      </span>
                      <span className="num text-[11px] text-muted-foreground">{fmtHM(new Date(m.at).toISOString())}</span>
                    </span>
                  )}
                  <span className="block text-[15px] leading-snug break-words text-pretty">{m.body}</span>
                </span>
              </button>
            ),
          )}
        </div>
        {!stuck && msgs.length > 0 && (
          <button
            type="button"
            onClick={jumpToEnd}
            className="absolute bottom-3 left-1/2 z-10 inline-flex h-9 -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground px-4 text-[13px] font-medium text-background shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
          >
            <ArrowDown className="size-4" aria-hidden />
            {unseen ? `${unseen} nova${unseen > 1 ? 's' : ''}` : 'Ir para o fim'}
          </button>
        )}
      </div>

      <div className="border-t bg-background">
        <Reactions room={room} reacts={reacts} burst={burst} disabled={degraded} />
        <form onSubmit={send} className="flex items-center gap-2 px-3">
          <div className="relative min-w-0 flex-1">
            <input
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_BODY))}
              maxLength={MAX_BODY}
              enterKeyHint="send"
              placeholder={placeholder}
              disabled={disabled}
              className="h-11 w-full rounded-full border bg-card px-4 pr-12 outline-none transition-[box-shadow,border-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-60"
              aria-label="Mensagem"
              aria-describedby="chat-status"
            />
            {text.length > 180 && (
              <span className={cn('num absolute top-1/2 right-4 -translate-y-1/2 text-[11px]', MAX_BODY - text.length < 20 ? 'text-destructive' : 'text-muted-foreground')}>
                {MAX_BODY - text.length}
              </span>
            )}
          </div>
          <Button
            type="submit"
            size="icon"
            disabled={disabled || !text.trim() || cool > 0}
            className="size-11 shrink-0 rounded-full"
            aria-label={cool ? `Aguarde ${cool} segundos` : 'Enviar'}
          >
            {cool ? <span className="num text-[13px] font-semibold">{cool}</span> : <SendHorizontal className="size-5" aria-hidden />}
          </Button>
        </form>
        <div id="chat-status" className="flex min-h-7 items-center justify-between gap-3 px-4 pt-1 pb-2 text-[11px] text-muted-foreground" aria-live="polite">
          {errText ? (
            <span className="font-medium text-destructive">{errText}</span>
          ) : (
            <span className="truncate">
              {me ? <>como <NickButton onClick={() => setNickOpen(true)} /></> : 'conectando…'}
            </span>
          )}
          <span className="shrink-0">sem links · seja gentil</span>
        </div>
      </div>

      <MessageActions m={picked} room={room} onClose={() => setPicked(null)} />
      <NickDrawer open={nickOpen} onOpenChange={setNickOpen} />
    </div>
  );
}

/** Ações por mensagem (toque): denunciar e copiar. 3 denúncias de pessoas diferentes removem. */
function MessageActions({ m, room, onClose }: { m: ChatMsg | null; room: Room; onClose: () => void }) {
  return (
    <Drawer open={!!m} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="mx-auto max-w-lg">
        {m && (
          <>
            <DrawerHeader className="text-left">
              <div className="flex items-center gap-2.5">
                <NickAvatar m={m} />
                <div className="min-w-0">
                  <DrawerTitle className={cn('truncate text-[15px]', NICK_CLS)} style={nickColor(m.hue)}>
                    {m.nick}
                  </DrawerTitle>
                  <span className="num text-[12px] text-muted-foreground">{fmtHM(new Date(m.at).toISOString())}</span>
                </div>
              </div>
              <DrawerDescription className="mt-3 rounded-lg bg-muted px-3 py-2 text-[15px] text-foreground">{m.body}</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter className="gap-2">
              <Button
                variant="outline"
                className="h-12 justify-start rounded-xl text-[15px]"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(m.body);
                    toast('Mensagem copiada');
                  } catch {
                    toast('Não deu para copiar');
                  }
                  onClose();
                }}
              >
                <Copy className="size-4" aria-hidden />
                Copiar texto
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-start rounded-xl text-[15px] text-destructive hover:text-destructive"
                onClick={() => {
                  live.report(room, m.id);
                  toast('Denúncia enviada. Obrigado por ajudar a moderar.');
                  onClose();
                }}
              >
                <Flag className="size-4" aria-hidden />
                Denunciar mensagem
              </Button>
              <p className="px-1 text-[11px] text-muted-foreground">
                Mensagens com 3 denúncias de pessoas diferentes saem do ar automaticamente.
              </p>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
