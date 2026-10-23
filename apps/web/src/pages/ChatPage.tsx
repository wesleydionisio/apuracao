import { UFS } from '@apuracao/shared';
import { useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { ShareButton } from '../components/ui';
import { live } from '../lib/live';
import { useBoard } from '../store/board';
import ChatView from './ChatView';

const LS_UF = 'chat:uf';
const LS_ROOM = 'chat:room';
const LS_NICK = 'nick';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem storage */
  }
};

export function savedNick() {
  return read(LS_NICK);
}

function NickEdit() {
  const me = useBoard((s) => s.me);
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState('');
  if (!me) return null;
  if (!edit)
    return (
      <button onClick={() => { setV(me.nick); setEdit(true); }} className="min-h-9 truncate text-[12px] text-muted underline">
        você é {me.nick}
      </button>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const n = v.trim().slice(0, 24);
        if (n.length >= 2) {
          write(LS_NICK, n);
          live.nick(n);
          useBoard.getState().set({ me: { ...me, nick: n } });
        }
        setEdit(false);
      }}
      className="flex gap-1"
    >
      <input value={v} onChange={(e) => setV(e.target.value)} maxLength={24} autoFocus className="h-9 w-36 rounded-lg border border-line bg-card px-2" aria-label="Apelido" />
      <button className="h-9 rounded-lg bg-fg px-3 text-[12px] font-semibold text-bg">ok</button>
    </form>
  );
}

export default function ChatPage() {
  const [uf, setUf] = useState(() => read(LS_UF) ?? '');
  const [room, setRoom] = useState(() => read(LS_ROOM) ?? 'br');
  const [, nav] = useLocation();
  const pick = (r: string) => {
    setRoom(r);
    write(LS_ROOM, r);
  };
  const ufRoom = uf.toLowerCase();
  const top = (
    <div className="border-b border-line px-3 py-2">
      <div className="flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
        <RoomChip on={room === 'br'} onClick={() => pick('br')}>#brasil</RoomChip>
        {uf ? (
          <RoomChip on={room === ufRoom} onClick={() => pick(ufRoom)}>#{ufRoom}</RoomChip>
        ) : null}
        <select
          value={uf}
          onChange={(e) => {
            setUf(e.target.value);
            write(LS_UF, e.target.value);
            if (e.target.value) pick(e.target.value.toLowerCase());
          }}
          className="h-9 shrink-0 rounded-full border border-line bg-card px-3 text-[13px]"
          aria-label="Sala do seu estado"
        >
          <option value="">{uf ? 'trocar UF' : '+ sala do seu estado'}</option>
          {Object.keys(UFS)
            .filter((k) => k !== 'ZZ')
            .map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
        </select>
        <button
          onClick={() => nav(`/sala/${Math.random().toString(36).slice(2, 8)}`)}
          className="h-9 shrink-0 rounded-full border border-dashed border-line px-3 text-[13px]"
        >
          + sala com amigos
        </button>
      </div>
      <div className="mt-1 flex justify-end">
        <NickEdit />
      </div>
    </div>
  );
  return <ChatView key={room} room={room} top={top} />;
}

function RoomChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold ${on ? 'bg-fg text-bg' : 'bg-soft text-fg'}`}
    >
      {children}
    </button>
  );
}

export function SalaPage() {
  const { slug } = useParams<{ slug: string }>();
  const safe = (slug ?? '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 32);
  const room = `sala:${safe.length >= 3 ? safe : `${safe}xxx`.slice(0, 3)}`;
  const top = (
    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-semibold">Sala privada · {room.slice(5)}</div>
        <div className="text-[11px] text-muted">Só quem tem o link entra. Placar ao vivo lá em cima.</div>
      </div>
      <ShareButton
        variant="ghost"
        label="Convidar"
        className="!min-h-10 shrink-0"
        input={{ title: 'Vem acompanhar a apuração comigo', text: 'Entra na minha sala para acompanhar a apuração ao vivo:', url: `/sala/${room.slice(5)}` }}
      />
    </div>
  );
  return <ChatView key={room} room={room} top={top} />;
}
