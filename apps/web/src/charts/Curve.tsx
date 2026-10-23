// Curva da noite: % de A por % de urnas apuradas, sobreposta à reconstrução de 2022.
// SVG à mão (em vez de Recharts): ~3 kB em vez de ~110 kB gzip, o que pesa no 4G.
import type { Board } from '@apuracao/shared';
import { useEffect, useMemo, useState } from 'react';
import { Card, Chip, Title } from '../components/ui';
import { staticData } from '../lib/api';
import { fmtPct } from '../lib/format';
import { candOf } from '../store/board';

type C22 = Awaited<ReturnType<typeof staticData.curve2022>>;
type Pt = { x: number; y: number; src?: string };

const W = 340;
const H = 200;
const PAD = { l: 30, r: 8, t: 8, b: 22 };

export default function Curve({ board }: { board: Board }) {
  const [c22, setC22] = useState<C22>(null);
  const [probe, setProbe] = useState<number | null>(null);
  useEffect(() => {
    staticData.curve2022().then(setC22).catch(() => setC22(null));
  }, []);
  const ca = candOf(board, 'a')!;
  const nA22 = board.y2022Map?.a;

  const now: Pt[] = useMemo(
    () => board.curve.filter((p) => p.pst >= 1).map((p) => ({ x: p.pst, y: p.pa })),
    [board.curve],
  );
  const past: Pt[] = useMemo(
    () =>
      c22 && nA22
        ? c22.points
            .filter((p) => p.pct[nA22] !== undefined)
            .map((p) => ({ x: p.pst, y: p.pct[nA22], src: (p as { src?: string }).src }))
        : [],
    [c22, nA22],
  );

  const ys = [...now, ...past].map((p) => p.y);
  const lo = Math.floor(Math.min(46, ...ys) - 1);
  const hi = Math.ceil(Math.max(54, ...ys) + 1);
  const sx = (x: number) => PAD.l + (x / 100) * (W - PAD.l - PAD.r);
  const sy = (y: number) => PAD.t + ((hi - y) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = (pts: Pt[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const yTicks = [lo, 50, hi].filter((v, i, a) => a.indexOf(v) === i);

  const at = (pts: Pt[], x: number) => {
    if (!pts.length || x < pts[0].x || x > pts[pts.length - 1].x) return null;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p;
    return best;
  };
  const pNow = probe !== null ? at(now, probe) : null;
  const pPast = probe !== null ? at(past, probe) : null;

  return (
    <Card>
      <Title right={c22 ? <Chip>2022 reconstruída</Chip> : undefined}>A noite de hoje × 2022</Title>
      <p className="mb-2 text-[12px] text-muted">
        % de {ca.short} nos votos válidos conforme as urnas são apuradas. Toque no gráfico para comparar.
      </p>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none select-none"
        role="img"
        aria-label={`Curva de ${ca.short}: hoje${now.length ? ` em ${fmtPct(now[now.length - 1].y)}%` : ''}${past.length ? ', comparada com 2022' : ''}`}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (e.pointerType === 'mouse' || e.buttons) {
            const r = e.currentTarget.getBoundingClientRect();
            const x = (((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r);
            setProbe(Math.max(0, Math.min(100, x * 100)));
          }
        }}
        onPointerLeave={() => setProbe(null)}
        onPointerUp={(e) => e.pointerType !== 'mouse' && setTimeout(() => setProbe(null), 1800)}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(v)} y2={sy(v)} stroke="var(--line)" strokeDasharray={v === 50 ? '4 4' : undefined} />
            <text x={PAD.l - 5} y={sy(v) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">
              {v}
            </text>
          </g>
        ))}
        {[0, 25, 50, 75, 100].map((v) => (
          <text key={v} x={sx(v)} y={H - 6} textAnchor={v === 0 ? 'start' : v === 100 ? 'end' : 'middle'} fontSize="10" fill="var(--muted)">
            {v}%
          </text>
        ))}
        {past.length > 1 && <path d={path(past)} fill="none" stroke="var(--muted)" strokeWidth="2" strokeDasharray="5 4" />}
        {past
          .filter((p) => p.src === 'fonte')
          .map((p) => (
            <circle key={p.x} cx={sx(p.x)} cy={sy(p.y)} r="3" fill="var(--card)" stroke="var(--muted)" strokeWidth="1.5" />
          ))}
        {now.length > 1 && <path d={path(now)} fill="none" stroke={ca.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {now.length > 0 && <circle cx={sx(now[now.length - 1].x)} cy={sy(now[now.length - 1].y)} r="4" fill={ca.color} />}
        {probe !== null && (
          <line x1={sx(probe)} x2={sx(probe)} y1={PAD.t} y2={H - PAD.b} stroke="var(--fg)" strokeOpacity=".35" />
        )}
      </svg>
      <div className="num mt-1 flex min-h-5 flex-wrap gap-x-3 text-[12px]">
        {probe !== null ? (
          <>
            <span className="text-muted">{fmtPct(probe, 0)}% apurado:</span>
            {pNow && <span style={{ color: ca.color }}>hoje {fmtPct(pNow.y)}%</span>}
            {pPast && <span className="text-muted">2022 {fmtPct(pPast.y)}%</span>}
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 text-muted">
              <span className="h-[3px] w-4 rounded" style={{ background: ca.color }} /> hoje
            </span>
            <span className="inline-flex items-center gap-1 text-muted">
              {c22 ? (
                <>
                  <span className="w-4 border-t-2 border-dashed border-muted" /> 2022
                </>
              ) : (
                'curva de 2022 indisponível'
              )}
            </span>
          </>
        )}
      </div>
      {c22 && (
        <p className="mt-1 text-[11px] text-muted">
          2022 é uma reconstrução aproximada: o TSE não publica a série da noite. Os pontos marcados vêm de registros da
          imprensa e do TSE; o resto é interpolado.
        </p>
      )}
    </Card>
  );
}
