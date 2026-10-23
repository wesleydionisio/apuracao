// Mini gráfico da noite para a tela Ao vivo: % dos válidos × % de urnas apuradas.
// Eixo x fixo em 0–100% apurado, para a curva de 2022 (tracejada) ficar no mesmo ponto da noite.
import type { Board } from '@apuracao/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

type P = [number, number];

/** cúbica monotônica (não "passa do ponto" entre amostras) */
function path(pts: P[]): string {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : '';
  const n = pts.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = dx[i] ? (pts[i + 1][1] - pts[i][1]) / dx[i] : 0;
  }
  const t: number[] = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${(pts[i][0] + h).toFixed(1)},${(pts[i][1] + t[i] * h).toFixed(1)} ${(pts[i + 1][0] - h).toFixed(1)},${(pts[i + 1][1] - t[i + 1] * h).toFixed(1)} ${pts[i + 1][0].toFixed(1)},${pts[i + 1][1].toFixed(1)}`;
  }
  return d;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function NightSpark({
  board,
  curve22,
  height = 112,
  className,
}: {
  board: Board;
  curve22?: { pst: number; pa: number }[] | null;
  height?: number;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const [ca, cb] = board.candidates;
  // ignora o ruído das primeiras urnas (< 0,5%)
  const pts = useMemo(() => board.curve.filter((p) => p.pst >= 0.5), [board.curve]);
  const last = pts[pts.length - 1];

  const padL = 4;
  const padR = 44;
  const padT = 10;
  const padB = 16;
  const iw = Math.max(80, w - padL - padR);
  const ih = height - padT - padB;

  const dev = Math.max(
    4,
    ...pts.map((p) => Math.abs(p.pa - 50)),
    ...(curve22 ?? []).map((p) => Math.abs(p.pa - 50)),
  );
  const span = Math.ceil((dev + 1) / 5) * 5;
  const x = (pst: number) => padL + (Math.min(100, Math.max(0, pst)) / 100) * iw;
  const y = (pa: number) => padT + ((50 + span - pa) / (2 * span)) * ih;

  const lineA = path(pts.map((p) => [x(p.pst), y(p.pa)]));
  const lineB = path(pts.map((p) => [x(p.pst), y(100 - p.pa)]));
  const g22 = curve22?.length ? curve22 : null;
  const a22 = g22 ? path(g22.map((p) => [x(p.pst), y(p.pa)])) : '';
  const b22 = g22 ? path(g22.map((p) => [x(p.pst), y(100 - p.pa)])) : '';

  // rótulos nas pontas, sem sobrepor
  let ya = last ? y(last.pa) : 0;
  let yb = last ? y(100 - last.pa) : 0;
  if (last && Math.abs(ya - yb) < 14) {
    const mid = (ya + yb) / 2;
    const up = ya < yb ? -7 : 7;
    ya = mid + up;
    yb = mid - up;
  }

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ height }}>
      <svg width={w} height={height} className="block overflow-visible" role="img" aria-label={last ? `Evolução da noite: com ${fmt(last.pst)}% apurado, ${ca.short} ${fmt(last.pa)}% e ${cb.short} ${fmt(100 - last.pa)}%` : 'Evolução da noite'}>
        <defs>
          <pattern id="spark-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className="stroke-border" strokeWidth="1" />
          </pattern>
        </defs>
        {/* o que falta apurar */}
        {last && last.pst < 99.5 && (
          <rect x={x(last.pst)} y={padT} width={x(100) - x(last.pst)} height={ih} fill="url(#spark-hatch)" opacity={0.55} />
        )}
        <line x1={padL} x2={x(100)} y1={y(50)} y2={y(50)} className="stroke-muted-foreground/40" strokeDasharray="3 4" />
        <text x={x(100) + 6} y={y(50) + 3.5} className="fill-muted-foreground text-[10px] font-medium tabular-nums">
          50%
        </text>
        <text x={x(100) + 6} y={padT + 4} className="fill-muted-foreground/70 text-[9.5px] tabular-nums">
          {50 + span}
        </text>
        <text x={x(100) + 6} y={padT + ih} className="fill-muted-foreground/70 text-[9.5px] tabular-nums">
          {50 - span}
        </text>
        {g22 && (
          <g opacity={0.55}>
            <path d={a22} fill="none" stroke={ca.color} strokeWidth={1.5} strokeDasharray="3 3" />
            <path d={b22} fill="none" stroke={cb.color} strokeWidth={1.5} strokeDasharray="3 3" />
          </g>
        )}
        <path d={lineB} fill="none" stroke={cb.color} strokeWidth={2.25} strokeLinecap="round" />
        <path d={lineA} fill="none" stroke={ca.color} strokeWidth={2.25} strokeLinecap="round" />
        {last && (
          <>
            {[
              { c: ca, py: y(last.pa), ly: ya, v: last.pa },
              { c: cb, py: y(100 - last.pa), ly: yb, v: 100 - last.pa },
            ].map(({ c, py, ly, v }) => (
              <g key={c.key}>
                <circle cx={x(last.pst)} cy={py} r={7} fill={c.color} opacity={0.18} className="live-ping" style={{ transformOrigin: `${x(last.pst)}px ${py}px` }} />
                <circle cx={x(last.pst)} cy={py} r={3.5} fill={c.color} className="stroke-background" strokeWidth={1.5} />
                {last.pst < 86 && (
                  <text x={x(last.pst) + 8} y={ly + 3.5} className="text-[11px] font-semibold tabular-nums" fill={c.color}>
                    {fmt(v)}%
                  </text>
                )}
              </g>
            ))}
          </>
        )}
        <text x={padL} y={height - 2} className="fill-muted-foreground text-[10px] tabular-nums">
          0%
        </text>
        <text x={x(100)} y={height - 2} textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
          100% apurado
        </text>
        {last && last.pst > 8 && last.pst < 88 && (
          <text x={x(last.pst)} y={height - 2} textAnchor="middle" className="fill-foreground text-[10px] font-medium tabular-nums">
            {fmt(last.pst)}%
          </text>
        )}
      </svg>
      {!pts.length && (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-muted-foreground">
          A linha começa a se formar com as primeiras urnas.
        </div>
      )}
    </div>
  );
}
