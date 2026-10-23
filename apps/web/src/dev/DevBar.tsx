// Barra de debug — só em `vite dev` com o poller em SOURCE=replay.
// Arrasta o % apurado para frente e para trás, pausa/acelera a noite e força "antes das 17h".
// Fica sobreposta ao topo (não mexe no layout que está sendo depurado) e recolhe num botão.
import type { Board, Snap } from '@apuracao/shared';
import { ChevronDown, ChevronUp, Pause, Play, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';

interface DevStatus {
  scenario: string;
  t: number;
  tEnd: number;
  pst: number;
  playing: boolean;
  speed: number;
  minutes: number;
  status: Snap['status'] | null;
  released: 'auto' | 'on' | 'off';
  br: Snap | null;
}

const ENDPOINT = '/__dev';
const SPEEDS = [1, 5, 20, 60];
const JUMPS = [0, 5, 10, 25, 50, 75, 90, 99];
const RELEASE: { v: DevStatus['released']; label: string }[] = [
  { v: 'auto', label: 'auto' },
  { v: 'off', label: 'antes das 17h' },
  { v: 'on', label: 'ao vivo' },
];

const lsGet = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const lsSet = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* sem storage */
  }
};

/** troca o placar inteiro (sem a mescla "só aceita mais novo", que bloquearia voltar no tempo) */
async function hardRefreshBoard() {
  const r = await fetch(`/data/br.json?dev=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) return;
  const board = (await r.json()) as Board;
  useBoard.setState({ board, seenAt: Date.now(), loadError: false });
}

export default function DevBar() {
  const [st, setSt] = useState<DevStatus | null>(null);
  const [off, setOff] = useState(false);
  const [open, setOpen] = useState(() => lsGet('devbar') !== 'closed');
  const [more, setMore] = useState(false);
  const [drag, setDrag] = useState<number | null>(null);
  const busy = useRef(false);
  const pending = useRef<Record<string, unknown> | null>(null);

  const send = useCallback(async (body: Record<string, unknown>) => {
    // um comando por vez; enquanto um roda, guarda só o último (arrastar gera muitos)
    if (busy.current) {
      pending.current = body;
      return;
    }
    busy.current = true;
    try {
      const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (r.ok) setSt(await r.json());
      await hardRefreshBoard().catch(() => {}); // arquivo pego no meio da escrita: o próximo comando/polling corrige
    } finally {
      busy.current = false;
      const next = pending.current;
      pending.current = null;
      if (next) void send(next);
    }
  }, []);

  // estado inicial + acompanhamento enquanto a noite corre
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(ENDPOINT, { cache: 'no-store' });
        if (!r.ok) throw new Error();
        const s = (await r.json()) as DevStatus;
        if (alive) {
          setSt(s);
          setOff(false);
        }
      } catch {
        if (alive) setOff(true);
      }
    };
    tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => lsSet('devbar', open ? 'open' : 'closed'), [open]);

  if (off || !st) return null;

  const pst = drag ?? st.pst;
  const br = st.br;
  const margin = br && br.valid ? br.pb - br.pa : null;

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed top-1 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-white/10 bg-black/80 px-3 py-1 font-mono text-[11px] text-white shadow-lg backdrop-blur"
        aria-label="Abrir barra de debug"
      >
        <SlidersHorizontal className="size-3" />
        DEV {fmtPct(st.pst, 1)}%
        <ChevronDown className="size-3" />
      </button>
    );

  return (
    <div
      className="fixed inset-x-0 top-0 z-[80] border-b border-white/10 bg-black/85 font-mono text-[11px] text-white shadow-xl backdrop-blur"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
      role="region"
      aria-label="Barra de debug da simulação"
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <span className="rounded bg-amber-400 px-1 py-px text-[10px] font-bold text-black">DEV</span>
        <button
          type="button"
          onClick={() => send({ playing: !st.playing })}
          className="grid size-7 shrink-0 place-items-center rounded-md bg-white/10 active:bg-white/20"
          aria-label={st.playing ? 'Pausar a noite' : 'Continuar a noite'}
        >
          {st.playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={0.5}
          value={pst}
          onChange={(e) => {
            const v = Number(e.target.value);
            setDrag(v);
            void send({ pst: v });
          }}
          onPointerUp={() => setDrag(null)}
          onKeyUp={() => setDrag(null)}
          onBlur={() => setDrag(null)}
          className="h-7 min-w-0 flex-1 accent-amber-400"
          aria-label="Percentual de urnas apuradas"
        />
        <span className="w-[52px] shrink-0 text-right tabular-nums">{fmtPct(pst, 1)}%</span>
        <button
          type="button"
          onClick={() => setMore((m) => !m)}
          className={cn('grid size-7 shrink-0 place-items-center rounded-md bg-white/10', more && 'bg-white/25')}
          aria-label="Mais controles"
          aria-expanded={more}
        >
          <SlidersHorizontal className="size-3.5" />
        </button>
        <button type="button" onClick={() => setOpen(false)} className="grid size-7 shrink-0 place-items-center rounded-md bg-white/10" aria-label="Recolher barra de debug">
          <ChevronUp className="size-3.5" />
        </button>
      </div>

      {more && (
        <div className="space-y-1.5 border-t border-white/10 px-2 py-2">
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-white/50">ir para</span>
            {JUMPS.map((j) => (
              <Chip key={j} onClick={() => send({ pst: j })}>
                {j}%
              </Chip>
            ))}
            <Chip onClick={() => send({ total: true })} active={st.status === 'totalizado'}>
              totalizar
            </Chip>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-white/50">velocidade</span>
            {SPEEDS.map((s) => (
              <Chip key={s} onClick={() => send({ speed: s })} active={st.speed === s}>
                {s}×
              </Chip>
            ))}
            <span className="ml-auto text-white/50">noite de {st.minutes} min a 1×</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-white/50">placar</span>
            {RELEASE.map((r) => (
              <Chip key={r.v} onClick={() => send({ released: r.v })} active={st.released === r.v}>
                {r.label}
              </Chip>
            ))}
            <button type="button" onClick={() => send({ reset: true, playing: false })} className="ml-auto inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-1">
              <RotateCcw className="size-3" /> reiniciar
            </button>
          </div>
          <div className="flex items-center justify-between gap-2 text-white/60">
            <span className="truncate">{st.scenario}</span>
            <span className="shrink-0 tabular-nums">
              {br?.valid ? `A ${fmtPct(br.pa)} × B ${fmtPct(br.pb)} · B−A ${margin! >= 0 ? '+' : ''}${fmtPct(margin!)}` : 'sem votos'} · {st.status ?? '—'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('rounded-md px-2 py-1 tabular-nums', active ? 'bg-amber-400 font-bold text-black' : 'bg-white/10 active:bg-white/20')}
    >
      {children}
    </button>
  );
}
