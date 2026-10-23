// Mapa real do Brasil por estado (SVG, d3-geo). 27 caminhos: desenha instantâneo até em Android barato.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct, ufName } from '@apuracao/shared';
import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { fillFor, inkFor, leaderOf, pair } from './colors';
import { LABEL_NUDGE, projectStates, statesPath, useGeo } from './geo';
import type { UfValue } from './data';

const W = 600;
const H = 580;
/** estados com área esférica acima disso ganham sigla (≈ 160 mil km²) */
const LABEL_AREA = 0.0039;

export function BrazilMap({
  values,
  cands,
  selected,
  onPick,
  labels = true,
  className,
  label = 'Mapa do Brasil por estado',
}: {
  values: Record<string, UfValue | undefined>;
  cands: CandidateDef[];
  selected?: string | null;
  onPick?: (uf: string) => void;
  labels?: boolean;
  className?: string;
  label?: string;
}) {
  const { fc, loading } = useGeo(statesPath);
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ uf: string; x: number; y: number } | null>(null);
  const states = useMemo(() => (fc ? projectStates(fc, W, H) : []), [fc]);

  if (loading && !fc) return <div className={cn('aspect-[600/580] w-full animate-pulse rounded-xl bg-muted', className)} />;
  if (!fc)
    return (
      <p className={cn('py-10 text-center text-sm text-muted-foreground', className)}>
        Malha do mapa indisponível agora. A lista de estados abaixo tem os mesmos dados.
      </p>
    );

  // o selecionado vai por último para o contorno não ficar por baixo dos vizinhos
  const ordered = selected ? [...states.filter((s) => s.uf !== selected), ...states.filter((s) => s.uf === selected)] : states;
  const tipVal = tip ? values[tip.uf] : undefined;

  return (
    <div ref={wrap} className={cn('relative w-full', className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full select-none"
        role={onPick ? 'group' : 'img'}
        aria-label={label}
        onPointerLeave={() => setTip(null)}
      >
        {ordered.map((s) => {
          const v = values[s.uf];
          const isSel = selected === s.uf;
          const lead = v?.pa != null ? leaderOf(v.pa, cands) : null;
          const desc =
            v?.pa != null && lead
              ? `${ufName(s.uf)}: ${lead.short} à frente com ${fmtPct(Math.max(v.pa, 100 - v.pa), 1)}%${v.pst != null ? `, ${fmtPct(v.pst, 0)}% apurado` : ''}`
              : `${ufName(s.uf)}: sem dados`;
          return (
            <path
              key={s.uf}
              d={s.d}
              fill={fillFor(v?.pa, cands)}
              stroke={isSel ? 'var(--foreground)' : 'var(--card)'}
              strokeWidth={isSel ? 2.5 : 1}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              className={cn(
                'transition-[fill,opacity] duration-300 ease-out',
                onPick && 'cursor-pointer outline-none focus-visible:opacity-80',
                selected && !isSel && 'opacity-55',
              )}
              {...(onPick
                ? {
                    role: 'button',
                    tabIndex: 0,
                    'aria-label': desc,
                    'aria-pressed': isSel,
                    onClick: () => onPick(s.uf),
                    onKeyDown: (e: React.KeyboardEvent) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onPick(s.uf);
                      }
                    },
                    onPointerMove: (e: React.PointerEvent) => {
                      if (e.pointerType !== 'mouse' || !wrap.current) return;
                      const r = wrap.current.getBoundingClientRect();
                      setTip({ uf: s.uf, x: e.clientX - r.left, y: e.clientY - r.top });
                    },
                  }
                : { 'aria-hidden': true })}
            >
              {!onPick && <title>{desc}</title>}
            </path>
          );
        })}
        {labels &&
          states
            .filter((s) => s.area > LABEL_AREA)
            .map((s) => {
              const [dx, dy] = LABEL_NUDGE[s.uf] ?? [0, 0];
              return (
                <text
                  key={`l-${s.uf}`}
                  x={s.cx + dx}
                  y={s.cy + dy}
                  textAnchor="middle"
                  dominantBaseline="central"
                  className="pointer-events-none text-[15px] font-semibold tracking-wide"
                  fill={inkFor(values[s.uf]?.pa)}
                  fillOpacity={0.9}
                  aria-hidden
                >
                  {s.uf}
                </text>
              );
            })}
      </svg>
      {tip && (
        <div
          className="pointer-events-none absolute z-10 min-w-36 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
          style={{ left: tip.x, top: tip.y }}
          role="tooltip"
        >
          <div className="font-semibold text-foreground">{ufName(tip.uf)}</div>
          {tipVal?.pa != null ? (
            <div className="num mt-1 flex items-center justify-between gap-3">
              <span style={{ color: cands[0].color }}>{pair(tipVal.pa)[0]}%</span>
              <span style={{ color: cands[1].color }}>{pair(tipVal.pa)[1]}%</span>
            </div>
          ) : (
            <div className="mt-0.5 text-muted-foreground">Sem dados ainda</div>
          )}
          {tipVal?.pst != null && <div className="num mt-0.5 text-muted-foreground">{fmtPct(tipVal.pst, 1)}% apurado</div>}
        </div>
      )}
    </div>
  );
}
