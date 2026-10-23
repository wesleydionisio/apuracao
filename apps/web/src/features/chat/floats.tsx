// Reações e torcida subindo pela lateral do chat (como corações numa live). Só transform/opacity.
import type { CandidateDef, Reaction } from '@apuracao/shared';
import { useEffect, useRef, useState } from 'react';
import { PartyBadge } from './parts';

type Item = { k: number; e: Reaction; x: number };

const listeners = new Set<(e: Reaction, n: number) => void>();
/** solta `n` itens na camada (o próprio toque e as rajadas que chegam do servidor) */
export function spawnFloat(e: Reaction, n = 1) {
  for (const l of listeners) l(e, n);
}

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
let seq = 0;

function Float({ item, cands, onDone }: { item: Item; cands: CandidateDef[] | null; onDone: () => void }) {
  const ref = useRef<HTMLSpanElement>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sway = (Math.random() - 0.5) * 36;
    const rise = 170 + Math.random() * 90;
    const a = el.animate(
      [
        { transform: 'translate3d(0,0,0) scale(.5)', opacity: 0 },
        { transform: `translate3d(${sway * 0.4}px,-24px,0) scale(1.1)`, opacity: 1, offset: 0.15 },
        { transform: `translate3d(${-sway * 0.5}px,-${rise * 0.55}px,0) scale(1)`, opacity: 1, offset: 0.6 },
        { transform: `translate3d(${sway}px,-${rise}px,0) scale(.9)`, opacity: 0 },
      ],
      { duration: 1500 + Math.random() * 500, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' },
    );
    a.onfinish = () => done.current();
    return () => a.cancel();
  }, []);
  const side = item.e === 'cheer:a' ? 'a' : item.e === 'cheer:b' ? 'b' : null;
  const c = side ? cands?.find((x) => x.key === side) : null;
  return (
    <span ref={ref} className="absolute bottom-0 opacity-0 will-change-transform" style={{ right: `${item.x}px` }}>
      {c ? <PartyBadge c={c} size="md" className="shadow-md" /> : <span className="text-[26px] leading-none drop-shadow-sm">{item.e}</span>}
    </span>
  );
}

export function FloatLayer({ cands }: { cands: CandidateDef[] | null }) {
  const [items, setItems] = useState<Item[]>([]);
  useEffect(() => {
    if (reduced()) return;
    const add = (e: Reaction, n: number) => {
      const batch = Array.from({ length: Math.min(n, 6) }, (_, i) => ({ k: ++seq, e, x: 6 + Math.random() * 44 + i * 3 }));
      // no máximo 18 no ar: em pico de torcida a tela não vira confete
      setItems((cur) => [...cur, ...batch].slice(-18));
    };
    listeners.add(add);
    return () => {
      listeners.delete(add);
    };
  }, []);
  return (
    <div className="pointer-events-none absolute right-0 bottom-2 z-10 h-0 w-24" aria-hidden>
      {items.map((it) => (
        <Float key={it.k} item={it} cands={cands} onDone={() => setItems((cur) => cur.filter((x) => x.k !== it.k))} />
      ))}
    </div>
  );
}
