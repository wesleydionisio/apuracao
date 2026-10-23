// Chat em tela cheia, pensado para teclado virtual no celular.
import type { ChatMsg, Reaction, Room } from '@apuracao/shared';
import { MAX_BODY, REACTIONS } from '@apuracao/shared';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { live } from '../lib/live';
import { fmtHM } from '../lib/format';
import { useBoard } from '../store/board';
import { useChat } from '../store/chat';

const EMPTY: ChatMsg[] = [];

const ERR_TEXT: Record<string, string> = {
  rate: 'Devagar! Espere um pouco para mandar outra.',
  slow: 'Modo lento ligado nesta sala.',
  blocked: 'Mensagem bloqueada: sem links, ofensas ou ameaças.',
  closed: 'Esta sala foi fechada pela moderação.',
  invalid: 'Mensagem inválida (máximo de 240 caracteres).',
  off: 'O chat está desligado no momento.',
};

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
  const [text, setText] = useState('');
  const [cool, setCool] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [stuck, setStuck] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    live.join(room);
    return () => live.leave(room);
  }, [room]);

  // cola no fim quando chega mensagem, se o usuário já estava no fim
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && stuck) el.scrollTop = el.scrollHeight;
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

  function send(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || disabled || cool) return;
    if (live.chat(room, body)) {
      setText('');
      setStuck(true);
      useChat.getState().setErr(room, undefined);
      if (slow) setCool(slow);
    }
  }

  const showErr = err && Date.now() - err.at < 8000 ? ERR_TEXT[err.code] ?? 'Não foi possível enviar.' : null;

  return (
    <div className="chat-shell fixed inset-x-0 z-20 mx-auto flex max-w-3xl flex-col bg-bg">
      {top}
      {(degraded || !enabled || closed) && (
        <div className="border-b border-line bg-soft px-4 py-2 text-[12px] text-muted">
          {closed
            ? 'Sala fechada pela moderação.'
            : !enabled
              ? 'Chat desligado no momento. O placar segue ao vivo.'
              : 'Chat reconectando… o placar continua atualizando normalmente.'}
        </div>
      )}
      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
        }}
        className="relative flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 py-3"
      >
        {!msgs.length && (
          <p className="py-10 text-center text-[13px] text-muted">
            {disabled ? 'Sem mensagens por enquanto.' : 'Seja a primeira pessoa a comentar 👋'}
          </p>
        )}
        {msgs.map((m) =>
          m.sys ? (
            <div key={m.id} className="my-2 rounded-xl border border-line bg-card px-3 py-2 text-[13px] font-medium">
              {m.body}
            </div>
          ) : (
            <div key={m.id} className="flex gap-2 py-1">
              <span
                aria-hidden
                className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold text-white"
                style={{ background: `hsl(${m.hue} 55% 45%)` }}
              >
                {m.nick.charAt(0).toUpperCase()}
              </span>
              <button type="button" onClick={() => setPicked(picked === m.id ? null : m.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-[12px] font-semibold" style={{ color: `hsl(${m.hue} 50% 42%)` }}>
                    {m.nick}
                  </span>
                  <span className="num text-[10px] text-muted">{fmtHM(new Date(m.at).toISOString())}</span>
                </div>
                <p className="break-words text-[15px] leading-snug">{m.body}</p>
                {picked === m.id && (
                  <span className="mt-1 flex gap-2">
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        live.report(room, m.id);
                        setPicked(null);
                      }}
                      className="inline-flex min-h-9 items-center rounded-lg border border-line px-3 text-[12px] text-muted"
                    >
                      🚩 Denunciar
                    </span>
                  </span>
                )}
              </button>
            </div>
          ),
        )}
      </div>
      {!stuck && msgs.length > 0 && (
        <button
          onClick={() => setStuck(true)}
          className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full bg-fg px-4 py-2 text-[12px] font-semibold text-bg shadow"
          style={{ bottom: 140 }}
        >
          novas mensagens ↓
        </button>
      )}
      <Reactions room={room} reacts={reacts} burst={burst} disabled={degraded} />
      <form onSubmit={send} className="flex items-end gap-2 border-t border-line bg-bg px-3 py-2">
        <div className="min-w-0 flex-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_BODY))}
            maxLength={MAX_BODY}
            enterKeyHint="send"
            placeholder={disabled ? 'Chat indisponível' : cool ? `Aguarde ${cool}s…` : `Mensagem como ${me?.nick ?? '…'}`}
            disabled={disabled}
            className="h-11 w-full rounded-full border border-line bg-card px-4 disabled:opacity-60"
            aria-label="Mensagem"
          />
          <div className="flex justify-between px-2 pt-1 text-[10px] text-muted">
            <span>{showErr ?? (slow ? `modo lento: 1 msg a cada ${slow}s` : 'sem links · seja gentil')}</span>
            {text.length > 180 && <span className="num">{MAX_BODY - text.length}</span>}
          </div>
        </div>
        <button
          disabled={disabled || !text.trim() || cool > 0}
          className="mb-4 h-11 w-11 shrink-0 rounded-full bg-fg text-bg disabled:opacity-40"
          aria-label="Enviar"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" className="mx-auto" fill="currentColor" aria-hidden>
            <path d="M3 20.5 21 12 3 3.5l.01 6.6L15 12 3.01 13.9z" />
          </svg>
        </button>
      </form>
    </div>
  );
}

function Reactions({
  room,
  reacts,
  burst,
  disabled,
}: {
  room: Room;
  reacts?: Partial<Record<Reaction, number>>;
  burst?: { e: Reaction; n: number; k: number };
  disabled: boolean;
}) {
  const [floats, setFloats] = useState<{ k: number; e: string; x: number }[]>([]);
  useEffect(() => {
    if (!burst) return;
    const f = { k: burst.k, e: burst.e, x: 10 + Math.random() * 80 };
    setFloats((cur) => [...cur.slice(-6), f]);
    const t = setTimeout(() => setFloats((cur) => cur.filter((x) => x.k !== f.k)), 1300);
    return () => clearTimeout(t);
  }, [burst]);
  return (
    <div className="relative flex justify-between gap-1 border-t border-line px-3 py-1.5">
      <div className="pointer-events-none absolute inset-x-0 bottom-full h-0">
        {floats.map((f) => (
          <span key={f.k} className="float-emoji absolute bottom-0 text-2xl" style={{ left: `${f.x}%` }}>
            {f.e}
          </span>
        ))}
      </div>
      {REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          disabled={disabled}
          onClick={() => {
            live.react(room, e);
            navigator.vibrate?.(8);
          }}
          className="flex h-11 flex-1 items-center justify-center gap-1 rounded-xl bg-soft press disabled:opacity-50"
          aria-label={`Reagir ${e}`}
        >
          <span className="text-xl leading-none">{e}</span>
          {!!reacts?.[e] && <span className="num text-[11px] text-muted">{compact(reacts[e]!)}</span>}
        </button>
      ))}
    </div>
  );
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k` : String(n));
