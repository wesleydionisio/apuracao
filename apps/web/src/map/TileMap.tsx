// Mapa em grade: 1 quadrado por UF. No celular é mais legível que o mapa geográfico (DF, SE, AL somem).
import type { CandidateDef } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import { fmtPct } from '../lib/format';
import { initialOf } from '../store/board';
import { marginColor } from './color';

// [coluna, linha]
const GRID: Record<string, [number, number]> = {
  RR: [1, 0], AP: [3, 0],
  AM: [1, 1], PA: [2, 1], MA: [3, 1], CE: [4, 1], RN: [5, 1],
  AC: [0, 2], RO: [1, 2], TO: [2, 2], PI: [3, 2], PE: [4, 2], PB: [5, 2],
  MT: [1, 3], GO: [2, 3], DF: [3, 3], BA: [4, 3], AL: [5, 3],
  MS: [1, 4], SP: [2, 4], MG: [3, 4], ES: [4, 4], SE: [5, 4],
  PR: [2, 5], RJ: [3, 5],
  RS: [1, 6], SC: [2, 6],
};

export interface TileValue {
  pa: number | null;
  pst?: number | null;
}

export default function TileMap({
  values,
  cands,
  selected,
  onPick,
}: {
  values: Record<string, TileValue | undefined>;
  cands: CandidateDef[];
  selected?: string | null;
  onPick?: (uf: string) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[420px]">
      <div className="grid grid-cols-6 gap-1.5">
        {Object.entries(GRID).map(([uf, [c, r]]) => {
          const v = values[uf];
          const bg = marginColor(v?.pa, cands);
          const strong = v?.pa != null && Math.abs(v.pa - 50) > 6;
          return (
            <button
              key={uf}
              type="button"
              onClick={() => onPick?.(uf)}
              aria-label={`${ufName(uf)}${v?.pa != null ? `: ${fmtPct(v.pa, 1)}% para ${cands[0].short}` : ''}`}
              aria-pressed={selected === uf}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-lg text-center press ${selected === uf ? 'ring-2 ring-fg ring-offset-2 ring-offset-bg' : ''}`}
              style={{ gridColumn: c + 1, gridRow: r + 1, background: bg, color: strong ? '#fff' : 'var(--fg)' }}
            >
              <span className="text-[13px] font-bold leading-none">{uf}</span>
              {v?.pa != null && (
                // inicial do líder: a cor não é o único sinal de quem está à frente
                <span className="num mt-0.5 text-[10px] leading-none opacity-90">
                  {initialOf(cands, v.pa >= 50 ? 0 : 1)} {fmtPct(Math.max(v.pa, 100 - v.pa), 0)}
                </span>
              )}
              {v?.pst != null && v.pst < 100 && (
                <span className="absolute inset-x-1.5 bottom-1 h-[3px] overflow-hidden rounded-full bg-black/15">
                  <span className="block h-full bg-current opacity-70" style={{ width: `${v.pst}%` }} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function MapLegend({ cands }: { cands: CandidateDef[] }) {
  const steps = [2, 6, 12, 20];
  return (
    <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[11px] text-muted">
      {cands.map((c, i) => (
        <span key={c.key} className="inline-flex items-center gap-1">
          {steps.map((m) => (
            <span key={m} className="h-3 w-3 rounded-sm" style={{ background: marginColor(i === 0 ? 50 + m : 50 - m, cands) }} />
          ))}
          <span className="ml-1">{c.short}</span>
        </span>
      ))}
      <span>cor mais forte = margem maior · barrinha = % apurado</span>
    </div>
  );
}
