// Chat de live: uma linha por mensagem, torcida no topo, selos de partido, emoji embutido.
// layout "shell": tela cheia no celular, entre cabeçalho e abas (acompanha o teclado — html.kb/.chat-shell).
// layout "panel": coluna lateral no desktop.
import type { ChatMsg, Reaction, Room } from '@apuracao/shared';
import { EMOJI_REACTIONS, MAX_BODY } from '@apuracao/shared';
import { ArrowDown, SendHorizontal, Smile, WifiOff, X } from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCandidates } from '@/components/core/candidate';
import { Button } from '@/components/ui/button';
import { live } from '@/lib/live';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { useChat } from '@/store/chat';
import { EmojiPanel } from './emoji';
import { FloatLayer, spawnFloat } from './floats';
import { useKeyboardOpen } from '@/features/watch/hooks';
import { useMountOnce } from './lazy';
import { ChatLine, NICK_CLS, NickAvatar, nickColor, PartyBadge, renderBody, SystemLine } from './parts';
import { read, write } from './rooms';
import { markOwn, ownRecent, TorcidaBar } from './torcida';

// gavetas (vaul) fora do bundle inicial
const MessageActions = lazy(() => import('./drawers').then((m) => ({ default: m.MessageActions })));
const ProfileDrawer = lazy(() => import('./drawers').then((m) => ({ default: m.ProfileDrawer })));
const SideDrawer = lazy(() => import('./drawers').then((m) => ({ default: m.SideDrawer })));

const EMPTY: ChatMsg[] = [];

const ERR_TEXT: Record<string, string> = {
  rate: 'Devagar: espere um pouco para mandar outra.',
  slow: 'Modo lento ligado nesta sala.',
  blocked: 'Mensagem bloqueada: sem links, ofensas ou ameaças.',
  closed: 'Esta sala foi fechada pela moderação.',
  invalid: 'Mensagem inválida (até 240 caracteres).',
  off: 'O chat está desligado no momento.',
};

const LS_REACT = 'react:default';
const savedReaction = (): Reaction => {
  const v = read(LS_REACT);
  return (EMOJI_REACTIONS as readonly string[]).includes(v ?? '') ? (v as Reaction) : '🔥';
};

export default function ChatView({
  room,
  top,
  roomBar,
  layout = 'shell',
  onEmojiOpen,
}: {
  room: Room;
  /** acima de tudo (o placar, na tela Ao vivo) */
  top?: ReactNode;
  /** linha das salas */
  roomBar?: ReactNode;
  layout?: 'shell' | 'panel';
  /** avisa quando o painel de emoji abre/fecha (a tela Ao vivo compacta o placar) */
  onEmojiOpen?: (open: boolean) => void;
}) {
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
  // digitando no celular: a torcida sai do caminho para sobrar espaço às mensagens
  const kb = useKeyboardOpen();
  const [text, setText] = useState('');
  const [cool, setCool] = useState(0);
  const [picked, setPicked] = useState<ChatMsg | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [ask, setAsk] = useState<{ then: () => void } | null>(null);
  const [stuck, setStuck] = useState(true);
  const actionsMounted = useMountOnce(!!picked);
  const profileMounted = useMountOnce(profileOpen);
  const sideMounted = useMountOnce(!!ask);
  const [unseen, setUnseen] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastLen = useRef(msgs.length);
  // o histórico que chega ao entrar não anima; só o que chega depois
  const initial = useRef<Set<string> | null>(null);
  if (initial.current === null && msgs.length) initial.current = new Set(msgs.map((m) => m.id));

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

  // a área de mensagens encolhe quando o painel de emoji abre: continua colada no fim
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
  }, [emojiOpen, stuck]);
  useEffect(() => {
    onEmojiOpen?.(emojiOpen);
  }, [emojiOpen, onEmojiOpen]);

  // rajadas de reação/torcida vindas do servidor (descontando os próprios toques recentes)
  useEffect(() => {
    if (!burst) return;
    const own = ownRecent.get(burst.e);
    let n = burst.n;
    if (own && Date.now() - own.at < 2500) {
      const used = Math.min(n, own.n);
      n -= used;
      own.n -= used;
    }
    if (n > 0) spawnFloat(burst.e, n);
  }, [burst]);

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

  /** pergunta o lado uma única vez, antes da primeira torcida ou mensagem */
  const ensureSide = useCallback(
    (then: () => void) => {
      if (useBoard.getState().me?.side || read('side:asked')) return then();
      setAsk({ then });
    },
    [],
  );

  function jumpToEnd() {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setStuck(true);
    setUnseen(0);
  }

  function doSend() {
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

  function insert(t: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    const pad = t.startsWith(':') && start > 0 && text[start - 1] !== ' ' ? ' ' : '';
    const next = (text.slice(0, start) + pad + t + text.slice(end)).slice(0, MAX_BODY);
    setText(next);
    requestAnimationFrame(() => {
      const pos = Math.min(next.length, start + pad.length + t.length);
      el?.setSelectionRange(pos, pos);
    });
  }

  const errText = err && Date.now() - err.at < 8000 ? (ERR_TEXT[err.code] ?? 'Não foi possível enviar.') : null;
  const placeholder = disabled ? 'Chat indisponível agora' : cool ? `Aguarde ${cool}s para a próxima` : 'Comente a apuração…';
  const mySide = me?.side ? cands?.find((c) => c.key === me.side) : null;
  const counts = { a: reacts?.['cheer:a'] ?? 0, b: reacts?.['cheer:b'] ?? 0 };

  return (
    <div
      className={cn(
        'flex flex-col bg-background',
        layout === 'shell'
          ? 'chat-shell fixed inset-x-0 z-20 mx-auto max-w-3xl lg:border-x'
          : 'h-full min-h-0 overflow-hidden rounded-2xl border bg-card',
      )}
    >
      {top}
      <div className={cn('border-b', layout === 'panel' && 'bg-card')}>
        {roomBar}
        {cands && !(kb && layout === 'shell') && (
          <TorcidaBar room={room} cands={cands} counts={counts} disabled={degraded} ensureSide={ensureSide} />
        )}
      </div>
      {disabled && (
        <div className="flex items-center gap-2 border-b bg-muted px-4 py-1.5 text-[12px] text-muted-foreground" role="status">
          <WifiOff className="size-3.5 shrink-0" aria-hidden />
          {closed
            ? 'Esta sala foi fechada pela moderação.'
            : !enabled
              ? 'Chat desligado no momento. O placar segue ao vivo.'
              : 'Reconectando o chat… o placar continua atualizando.'}
        </div>
      )}
      {slow > 0 && !disabled && (
        <div className="border-b bg-muted/60 px-4 py-1 text-[11.5px] text-muted-foreground" role="status">
          Modo lento: 1 mensagem a cada <span className="num font-medium text-foreground">{slow}s</span>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
            setStuck(atEnd);
            if (atEnd) setUnseen(0);
          }}
          className="h-full overflow-y-auto overscroll-contain py-1.5"
          role="log"
          aria-label="Mensagens do chat"
          aria-live="polite"
        >
          {!msgs.length && <EmptyChat disabled={disabled} cands={cands} />}
          {msgs.map((m) =>
            m.sys ? (
              <SystemLine key={m.id} m={m} cands={cands} fresh={!!initial.current && !initial.current.has(m.id)} />
            ) : (
              <ChatLine
                key={m.id}
                m={m}
                cands={cands}
                fresh={!!initial.current && !initial.current.has(m.id)}
                mine={!!me && m.nick === me.nick && m.hue === me.hue}
                onPick={setPicked}
              />
            ),
          )}
        </div>
        <FloatLayer cands={cands} />
        {!stuck && msgs.length > 0 && (
          <button
            type="button"
            onClick={jumpToEnd}
            className="absolute bottom-2.5 left-1/2 z-10 inline-flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground px-3.5 text-[12.5px] font-medium text-background shadow-lg animate-in fade-in-0 slide-in-from-bottom-2"
          >
            <ArrowDown className="size-3.5" aria-hidden />
            {unseen ? `${unseen} nova${unseen > 1 ? 's' : ''}` : 'Ao vivo'}
          </button>
        )}
      </div>

      {emojiOpen && <EmojiPanel cands={cands} onPick={insert} />}
      <div className={cn('border-t', layout === 'panel' ? 'bg-card' : 'bg-background')}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            ensureSide(doSend);
          }}
          className="flex items-center gap-2 px-3 pt-2"
        >
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="relative shrink-0 rounded-full"
            aria-label={me ? `Seu perfil: ${me.nick}${mySide ? `, torce ${mySide.n}` : ''}. Editar` : 'Seu perfil'}
          >
            {me ? <NickAvatar m={me} className="size-9" /> : <span className="block size-9 rounded-full bg-muted" />}
            {mySide && <PartyBadge c={mySide} className="absolute -right-1.5 -bottom-1 h-[15px] px-1 text-[9.5px] ring-2 ring-background" />}
          </button>
          <div className="relative min-w-0 flex-1">
            <input
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_BODY))}
              maxLength={MAX_BODY}
              enterKeyHint="send"
              placeholder={placeholder}
              disabled={disabled}
              className="h-10 w-full rounded-full border bg-muted/50 pr-11 pl-4 outline-none transition-[box-shadow,border-color,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60"
              aria-label="Mensagem"
              aria-describedby="chat-status"
            />
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setEmojiOpen((o) => !o)}
              className={cn(
                'absolute top-1/2 right-1 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground',
                emojiOpen && 'bg-accent text-foreground',
              )}
              aria-label={emojiOpen ? 'Fechar emojis' : 'Emojis e selos de torcida'}
              aria-expanded={emojiOpen}
            >
              {emojiOpen ? <X className="size-[18px]" /> : <Smile className="size-[18px]" />}
            </button>
          </div>
          {text.trim() ? (
            <Button
              type="submit"
              size="icon"
              disabled={disabled || cool > 0}
              className="size-10 shrink-0 rounded-full"
              onPointerDown={(e) => e.preventDefault()}
              aria-label={cool ? `Aguarde ${cool} segundos` : 'Enviar'}
            >
              {cool ? <span className="num text-[13px] font-semibold">{cool}</span> : <SendHorizontal className="size-[18px]" aria-hidden />}
            </Button>
          ) : (
            <ReactButton room={room} disabled={degraded} />
          )}
        </form>
        <div
          id="chat-status"
          className="flex min-h-6 items-center justify-between gap-3 px-4 pt-1 pb-1.5 text-[11px] text-muted-foreground"
          aria-live="polite"
        >
          {errText ? (
            <span className="font-medium text-destructive">{errText}</span>
          ) : text.length > 180 ? (
            <span className={cn('num', MAX_BODY - text.length < 20 && 'text-destructive')}>{MAX_BODY - text.length} caracteres</span>
          ) : (
            <span className="min-w-0 truncate">
              {me ? (
                <>
                  como{' '}
                  <button type="button" onClick={() => setProfileOpen(true)} className={cn('font-semibold hover:underline', NICK_CLS)} style={nickColor(me.hue)}>
                    {me.nick}
                  </button>
                </>
              ) : (
                'conectando…'
              )}
            </span>
          )}
          <span className="shrink-0">sem links · seja gentil</span>
        </div>
      </div>

      <Suspense fallback={null}>
        {actionsMounted && <MessageActions m={picked} room={room} cands={cands} onClose={() => setPicked(null)} />}
        {profileMounted && <ProfileDrawer open={profileOpen} onOpenChange={setProfileOpen} cands={cands} />}
        {sideMounted && (
          <SideDrawer
            open={!!ask}
            onOpenChange={(o) => !o && setAsk(null)}
            cands={cands}
            onDone={() => {
              const then = ask?.then;
              setAsk(null);
              then?.();
            }}
          />
        )}
      </Suspense>
    </div>
  );
}

function EmptyChat({ disabled, cands }: { disabled: boolean; cands: ReturnType<typeof useCandidates> }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <p className="text-[14px] font-semibold">{disabled ? 'Sem mensagens por enquanto' : 'Seja o primeiro a comentar'}</p>
      <p className="mt-1 max-w-[30ch] text-[12.5px] leading-relaxed text-muted-foreground">
        {disabled ? (
          'Assim que o chat voltar, as mensagens aparecem aqui.'
        ) : cands ? (
          <>
            Viradas e marcos aparecem aqui em tempo real. Escreva {renderBody(`:${cands[0].n}:`, cands)} ou{' '}
            {renderBody(`:${cands[1].n}:`, cands)} para mandar o selo da sua torcida.
          </>
        ) : (
          'Viradas e marcos da apuração também aparecem aqui, em tempo real.'
        )}
      </p>
    </div>
  );
}

/**
 * Sem texto, o botão de enviar vira reação (como os corações de uma live): toque manda,
 * segurar abre a escolha do emoji.
 */
function ReactButton({ room, disabled }: { room: Room; disabled: boolean }) {
  const [cur, setCur] = useState<Reaction>(savedReaction);
  const [choose, setChoose] = useState(false);
  const [pop, setPop] = useState(0);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const send = (e: Reaction) => {
    live.react(room, e);
    markOwn(e);
    spawnFloat(e, 1);
    navigator.vibrate?.(8);
    setPop((p) => p + 1);
  };
  return (
    <div className="relative shrink-0">
      {choose && (
        <div
          className="absolute right-0 bottom-12 z-20 flex gap-0.5 rounded-full border bg-popover p-1 shadow-xl animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2"
          role="menu"
          aria-label="Escolher reação"
        >
          {EMOJI_REACTIONS.map((e) => (
            <button
              key={e}
              type="button"
              role="menuitem"
              onPointerDown={(ev) => ev.preventDefault()}
              onClick={() => {
                setCur(e);
                write(LS_REACT, e);
                setChoose(false);
                send(e);
              }}
              className="flex size-10 items-center justify-center rounded-full text-[22px] transition-transform duration-100 hover:bg-accent active:scale-90"
              aria-label={`Reagir com ${e}`}
            >
              {e}
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        disabled={disabled}
        onPointerDown={(e) => {
          e.preventDefault();
          held.current = false;
          hold.current = setTimeout(() => {
            held.current = true;
            setChoose(true);
            navigator.vibrate?.(12);
          }, 420);
        }}
        onPointerUp={() => hold.current && clearTimeout(hold.current)}
        onPointerLeave={() => hold.current && clearTimeout(hold.current)}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          if (held.current) return;
          if (choose) return setChoose(false);
          send(cur);
        }}
        className="flex size-10 items-center justify-center rounded-full border bg-card text-[20px] transition-transform duration-150 ease-out select-none active:scale-90 disabled:opacity-40"
        aria-label={`Reagir com ${cur} (segure para escolher outro)`}
        aria-haspopup="menu"
      >
        <span key={pop} className={cn(pop && 'animate-in zoom-in-75 duration-200')}>
          {cur}
        </span>
      </button>
    </div>
  );
}

