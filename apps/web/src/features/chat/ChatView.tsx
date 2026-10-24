// Chat de live: uma linha por mensagem, torcida no topo, selos de partido, emoji embutido.
// layout "shell": tela cheia no celular, entre cabeçalho e abas (acompanha o teclado — html.kb/.chat-shell).
// layout "panel": coluna lateral no desktop.
import type { CandidateDef, ChatMsg, Room } from '@apuracao/shared';
import { MAX_BODY } from '@apuracao/shared';
import { ArrowDown, BadgeDollarSign, Heart, SendHorizontal, Smile, UserRound, WifiOff, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useCandidates } from '@/components/core/candidate';
import { Button } from '@/components/ui/button';
import { live, savedSide } from '@/lib/live';
import { cn } from '@/lib/utils';
import { ghostBoard } from '@/lib/ghost';
import { useBoard } from '@/store/board';
import { useChat } from '@/store/chat';
import { EmojiPanel } from './emoji';
import { FloatLayer, spawnFloat } from './floats';
import { LoginGate, SideGate } from './gates';
import { useKeyboardOpen } from '@/features/watch/hooks';
import { GuessStrip } from '@/features/guess/GuessCta';
import { useSite } from '@/lib/site';
import { PinnedBar, SuperLine } from './superchat';
import { useMountOnce } from './lazy';
import { ChatLine, ModLine, NICK_CLS, NickAvatar, nickColor, PartyBadge, renderBody, SystemLine } from './parts';
import { BumpButton, ownRecent, TorcidaBar, TorcidaMini } from './torcida';

// gavetas (vaul) fora do bundle inicial
const MessageActions = lazy(() => import('./drawers').then((m) => ({ default: m.MessageActions })));
const ProfileDrawer = lazy(() => import('./drawers').then((m) => ({ default: m.ProfileDrawer })));
const SuperchatSheet = lazy(() => import('./SuperchatSheet'));

const EMPTY: ChatMsg[] = [];

/** 45 -> "45s"; 130 -> "2:10"; 7200 -> "2h00" */
function fmtWait(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

const ERR_TEXT: Record<string, string> = {
  rate: 'Devagar: espere um pouco para mandar outra.',
  slow: 'Modo lento ligado nesta sala.',
  busy: 'Sala muito movimentada: tente de novo em instantes.',
  blocked: 'Mensagem bloqueada: sem links, ofensas ou ameaças.',
  closed: 'Esta sala foi fechada pela moderação.',
  invalid: 'Mensagem inválida (até 240 caracteres).',
  off: 'O chat está desligado no momento.',
  auth: 'Entre com o Google para comentar.',
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
  const board = useBoard((s) => s.board);
  const scOn = useSite((s) => s.site.superchat);
  const cands = useCandidates();
  // digitando no celular: a torcida sai do caminho para sobrar espaço às mensagens
  const kb = useKeyboardOpen();
  const [text, setText] = useState('');
  // última enviada: se o servidor recusar por ritmo (sala cheia, modo lento), o texto volta para o campo
  const lastSent = useRef<{ body: string; at: number } | null>(null);
  const [cool, setCool] = useState(0);
  const [picked, setPicked] = useState<ChatMsg | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // entrar com o Google: pedido ao mandar a primeira mensagem; a mensagem segue depois de entrar
  const [login, setLogin] = useState(false);
  // a escolha de lado pode ser fechada (tocar fora): volta ao torcer, comentar ou entrar
  const [sideClosed, setSideClosed] = useState(false);
  const sendAfterLogin = useRef(false);
  // Super Chat: pede lado e login antes, como a mensagem comum; depois de entrar a gaveta abre sozinha
  const [scOpen, setScOpen] = useState(false);
  const scAfterLogin = useRef(false);
  const scMounted = useMountOnce(scOpen);
  const [stuck, setStuck] = useState(true);
  const actionsMounted = useMountOnce(!!picked);
  const profileMounted = useMountOnce(profileOpen);
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
    // censurado: limpa o que estava digitado para o aviso com o tempo ficar à vista
    if (err?.code === 'muted') setText('');
    const sent = lastSent.current;
    if ((err?.code === 'busy' || err?.code === 'rate' || err?.code === 'slow') && sent && Date.now() - sent.at < 10_000) {
      lastSent.current = null;
      setText((t) => t || sent.body);
    }
    // a sessão caiu no servidor: entra de novo e manda
    if (err?.code === 'auth' && Date.now() - err.at < 5000) {
      sendAfterLogin.current = true;
      setLogin(true);
    }
  }, [err]);

  const degraded = link !== 'live' && link !== 'demo';
  const disabled = degraded || !enabled || closed;

  function jumpToEnd() {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    setStuck(true);
    setUnseen(0);
  }

  function doSend() {
    const body = text.trim();
    if (!body || disabled || cool) return;
    if (!mySide) return setSideClosed(false);
    if (!useBoard.getState().me?.auth) {
      sendAfterLogin.current = true;
      setLogin(true);
      return;
    }
    if (live.chat(room, body)) {
      lastSent.current = { body, at: Date.now() };
      setText('');
      setStuck(true);
      setUnseen(0);
      useChat.getState().setErr(room, undefined);
      if (slow) setCool(slow);
    }
  }

  // entrou (o WS reconectou com a conta): manda o que estava esperando
  const authed = !!me?.auth;
  useEffect(() => {
    if (authed && scAfterLogin.current) {
      scAfterLogin.current = false;
      setScOpen(true);
    }
    if (!authed || !sendAfterLogin.current) return;
    sendAfterLogin.current = false;
    doSend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authed]);

  function openSuperchat() {
    if (!mySide) return setSideClosed(false);
    if (!useBoard.getState().me?.auth) {
      scAfterLogin.current = true;
      setLogin(true);
      return;
    }
    setScOpen(true);
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

  const mutedNow = err?.code === 'muted' && cool > 0;
  // moderação: o aviso fica só na caixa de texto (e na linha censurada do chat); sem texto repetido embaixo
  const modErr = err?.code === 'muted' || err?.code === 'blocked';
  const errText = err && !modErr && Date.now() - err.at < 8000 ? (ERR_TEXT[err.code] ?? 'Não foi possível enviar.') : null;
  const placeholder = disabled
    ? 'Chat indisponível agora'
    : mutedNow
      ? `Censurado, melhor se comportar! ${fmtWait(cool)}`
      : cool
        ? `Aguarde ${cool}s para a próxima`
        : 'Comente a apuração…';
  const sideKey = me ? (me.side ?? null) : savedSide();
  const mySide = sideKey ? cands?.find((c) => c.key === sideKey) : null;
  const counts = { a: reacts?.['cheer:a'] ?? 0, b: reacts?.['cheer:b'] ?? 0 };

  return (
    <div
      className={cn(
        'flex flex-col bg-background',
        layout === 'shell'
          ? 'chat-shell fixed inset-x-0 z-20 mx-auto max-w-3xl lg:border-x'
          : 'relative h-full min-h-0 overflow-hidden rounded-2xl border bg-card',
      )}
    >
      {top}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {layout === 'panel' ? (
          <div className="border-b bg-card">
            {roomBar}
            {/* sem candidatos ainda: a barra em fantasma, para a lista não descer quando eles chegam */}
            {cands ? (
              <TorcidaBar cands={cands} counts={counts} />
            ) : (
              <div className="ghost" aria-hidden>
                <TorcidaBar cands={ghostBoard().candidates as [CandidateDef, CandidateDef]} counts={{ a: 0, b: 0 }} />
              </div>
            )}
            <PinnedBar room={room} cands={cands} />
          </div>
        ) : (
          // celular: sala e torcida dividem uma linha; digitando, a linha sai para sobrar espaço às mensagens
          !kb && (
            <>
              <div className="flex h-11 items-center justify-between gap-3 border-b px-4">
                {roomBar}
                {cands && <TorcidaMini cands={cands} counts={counts} />}
              </div>
              <div className="border-b empty:hidden">
                <PinnedBar room={room} cands={cands} />
              </div>
            </>
          )
        )}
        <div className="relative min-h-0 flex-1">
          {/* avisos flutuam sobre o topo da lista: aparecer ou sumir não empurra as mensagens */}
          <div className="absolute inset-x-0 top-0 z-10">
            {!disabled && <GuessStrip board={board} />}
            {disabled && (
              <div className="flex items-center gap-2 border-b bg-muted/95 px-4 py-1.5 text-[12px] text-muted-foreground backdrop-blur" role="status">
                <WifiOff className="size-3.5 shrink-0" aria-hidden />
                {closed
                  ? 'Esta sala foi fechada pela moderação.'
                  : !enabled
                    ? 'Chat desligado no momento. O placar segue ao vivo.'
                    : 'Reconectando o chat… o placar continua atualizando.'}
              </div>
            )}
            {slow > 0 && !disabled && (
              <div className="border-b bg-muted/90 px-4 py-1 text-[11.5px] text-muted-foreground backdrop-blur" role="status">
                Modo lento: 1 mensagem a cada <span className="num font-medium text-foreground">{slow}s</span>
              </div>
            )}
          </div>
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
              m.sc ? (
                <SuperLine key={m.id} m={m} cands={cands} fresh={!!initial.current && !initial.current.has(m.id)} />
              ) : m.sys ? (
                <SystemLine key={m.id} m={m} cands={cands} fresh={!!initial.current && !initial.current.has(m.id)} />
              ) : m.mod ? (
                <ModLine key={m.id} m={m} cands={cands} fresh={!!initial.current && !initial.current.has(m.id)} />
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
              doSend();
            }}
            className="flex items-center gap-2 px-3 pt-2"
          >
            <button
              type="button"
              onClick={() => (me?.auth ? setProfileOpen(true) : mySide ? setLogin(true) : setSideClosed(false))}
              className="relative shrink-0 rounded-full"
              aria-label={me?.auth ? `Seu perfil: ${me.nick}${mySide ? `, torce ${mySide.n}` : ''}` : 'Entrar com o Google'}
            >
              {me?.auth ? <NickAvatar m={me} className="size-9" /> : (
              <span className="flex size-9 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 bg-muted text-muted-foreground transition-colors hover:text-foreground">
                <UserRound className="size-[18px]" aria-hidden />
              </span>
            )}
              {mySide && <PartyBadge c={mySide} className="absolute -right-1.5 -bottom-1 h-[15px] px-1 text-[11px] ring-2 ring-background" />}
            </button>
            <div className="relative min-w-0 flex-1">
              <input
                ref={inputRef}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, MAX_BODY))}
                maxLength={MAX_BODY}
                enterKeyHint="send"
                placeholder={placeholder}
                disabled={disabled || mutedNow}
                className={cn('h-10 w-full rounded-full border border-input bg-muted/50 pl-4 outline-none transition-[box-shadow,border-color,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-60', mutedNow ? 'pr-4 placeholder:text-[13px]' : scOn ? 'pr-[4.5rem]' : 'pr-11')}
                aria-label="Mensagem"
                aria-describedby="chat-status"
              />
              {!mutedNow && scOn && (
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={openSuperchat}
                  disabled={disabled}
                  className="absolute top-1/2 right-9 flex size-8 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                  aria-label="Mandar um Super Chat (Pix)"
                >
                  <BadgeDollarSign className="size-[18px]" />
                </button>
              )}
              {!mutedNow && <button
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
              </button>}
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
                {cool && !mutedNow ? <span className="num text-[12px] font-semibold">{cool}</span> : <SendHorizontal className="size-[18px]" aria-hidden />}
              </Button>
            ) : (
              mySide ? (
                <BumpButton room={room} c={mySide} disabled={degraded} />
              ) : (
                <button
                  type="button"
                  onClick={() => setSideClosed(false)}
                  className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-muted-foreground/40 bg-muted text-muted-foreground transition-colors hover:text-foreground"
                  aria-label="Escolher seu lado para torcer"
                >
                  <Heart className="size-[18px]" aria-hidden />
                </button>
              )
            )}
          </form>
          <div
            id="chat-status"
            className="flex min-h-6 items-center justify-between gap-3 px-4 pt-1 pb-1.5 text-[11px] text-muted-foreground"
            aria-live="polite"
          >
            {errText ? (
              <span className="font-medium text-foreground/80">{errText}</span>
            ) : text.length > 180 ? (
              <span className={cn('num', MAX_BODY - text.length < 20 && 'text-destructive')}>{MAX_BODY - text.length} caracteres</span>
            ) : (
              <span className="min-w-0 truncate">
                {me && !me.auth ? (
                  <button type="button" onClick={() => setLogin(true)} className="font-semibold text-foreground hover:underline">
                    Entre com o Google para comentar
                  </button>
                ) : me ? (
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

        {cands && !mySide && !sideClosed && <SideGate cands={cands} onPick={(s) => live.side(s)} onClose={() => setSideClosed(true)} />}
      </div>

      {/* o login cobre a coluna inteira (placar incluso): o cadastro precisa de espaço no celular */}
      {login && mySide && (
        <LoginGate
          onClose={() => {
            sendAfterLogin.current = false;
            scAfterLogin.current = false;
            setLogin(false);
          }}
          onDone={() => {
            setLogin(false);
            live.reconnect();
          }}
        />
      )}

      <Suspense fallback={null}>
        {actionsMounted && <MessageActions m={picked} room={room} cands={cands} onClose={() => setPicked(null)} />}
        {profileMounted && <ProfileDrawer open={profileOpen} onOpenChange={setProfileOpen} cands={cands} />}
        {scMounted && (
          <SuperchatSheet
            open={scOpen}
            onOpenChange={setScOpen}
            room={room}
            cands={cands}
            onAuth={() => {
              setScOpen(false);
              scAfterLogin.current = true;
              setLogin(true);
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
