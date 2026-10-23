// Ficha de um estado que acompanha o mouse sobre o mapa (desktop): quem lidera, placar, % apurado e referências.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct, ufName } from '@apuracao/shared';
import { CandidateAvatar } from '@/components/core/candidate';
import { leaderOf, pair } from './colors';
import type { UfValue } from './data';

export function UfTip({
  uf,
  x,
  y,
  value,
  cands,
  refs,
}: {
  uf: string;
  /** posição do mouse dentro do mapa, em px CSS */
  x: number;
  y: number;
  value: UfValue | undefined;
  cands: CandidateDef[];
  /** referências: rótulo → % de A por UF */
  refs?: { label: string; values: Record<string, number | null> }[];
}) {
  const lead = value?.pa != null ? leaderOf(value.pa, cands) : null;
  return (
    <div
      className="pointer-events-none absolute z-10 w-52 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-xl border bg-popover p-3 text-xs shadow-lg"
      style={{ left: `clamp(104px, ${x}px, calc(100% - 104px))`, top: y }}
      role="tooltip"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[13px] font-semibold text-foreground">{ufName(uf)}</span>
        {lead && <CandidateAvatar c={lead} size="xs" />}
      </div>
      {value?.pa != null ? (
        <>
          <div className="num mt-1.5 flex items-center justify-between gap-3 text-[13px] font-semibold">
            <span style={{ color: cands[0].color }}>{pair(value.pa)[0]}%</span>
            <span style={{ color: cands[1].color }}>{pair(value.pa)[1]}%</span>
          </div>
          <div className="mt-1.5 flex h-1 overflow-hidden rounded-full bg-muted">
            <span style={{ width: `${value.pa}%`, background: cands[0].color }} />
            <span className="flex-1" style={{ background: cands[1].color }} />
          </div>
        </>
      ) : (
        <div className="mt-1 text-muted-foreground">Sem dados ainda</div>
      )}
      {value?.pst != null && <div className="num mt-1.5 text-muted-foreground">{fmtPct(value.pst, 1)}% apurado</div>}
      {refs?.map((r) => {
        const v = r.values[uf];
        return v == null ? null : (
          <div key={r.label} className="num mt-1 flex justify-between gap-2 text-muted-foreground">
            <span>{r.label}</span>
            <span>
              {pair(v)[0]} × {pair(v)[1]}
            </span>
          </div>
        );
      })}
    </div>
  );
}
