// Sankey simples do estoque do 1º turno: eliminados + brancos/nulos + abstenção → A, B ou ninguém.
// SVG só para as faixas (escala livre); rótulos em HTML para o texto nunca distorcer.
import type { CandidateDef, Transfer } from '@apuracao/shared';
import { CandidateAvatar } from '@/components/core/candidate';
import { fmtCompact, fmtPct } from '@/lib/format';

const H = 168;
const GAP = 8;

interface Node {
  key: string;
  label: string;
  value: number;
  color: string;
  c?: CandidateDef;
}

export function TransferSankey({ t, ca, cb }: { t: Transfer; ca: CandidateDef; cb: CandidateDef }) {
  const ga = Math.max(0, t.gainA);
  const gb = Math.max(0, t.gainB);
  const rest = Math.max(0, t.stock - ga - gb);
  const total = ga + gb + rest;
  if (total <= 0) return null;
  const nodes: Node[] = [
    { key: 'a', label: ca.short, value: ga, color: ca.color, c: ca },
    { key: 'b', label: cb.short, value: gb, color: cb.color, c: cb },
    { key: 'r', label: 'Ninguém dos dois', value: rest, color: 'var(--muted-foreground)' },
  ];
  // altura útil à direita (descontando os vãos) e posição de cada nó
  const usable = H - GAP * (nodes.length - 1);
  let yR = 0;
  let yL = 0;
  const laid = nodes.map((n) => {
    const h = Math.max(2, (n.value / total) * usable);
    const hl = (n.value / total) * H;
    const r = { ...n, y0: yR, y1: yR + h, l0: yL, l1: yL + hl };
    yR += h + GAP;
    yL += hl;
    return r;
  });
  // faixas: saem da coluna da esquerda (x 0–4) e chegam à direita (x 96–100), em 0–100 de largura
  const band = (l0: number, l1: number, r0: number, r1: number) =>
    `M4,${l0} C50,${l0} 50,${r0} 96,${r0} L96,${r1} C50,${r1} 50,${l1} 4,${l1} Z`;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,11rem)] items-stretch gap-3">
      <div className="relative" style={{ height: H }}>
        <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <rect x={0} y={0} width={4} height={H} rx={1.5} fill="var(--foreground)" opacity={0.85} />
          {laid.map((n) => (
            <path key={n.key} d={band(n.l0, n.l1, n.y0, n.y1)} fill={n.color} opacity={n.key === 'r' ? 0.18 : 0.42} />
          ))}
          {laid.map((n) => (
            <rect key={`n-${n.key}`} x={96} y={n.y0} width={4} height={n.y1 - n.y0} rx={1.5} fill={n.color} opacity={n.key === 'r' ? 0.5 : 1} />
          ))}
        </svg>
        <div className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 rounded-md bg-card/85 px-1.5 py-1 text-[11px] leading-tight backdrop-blur-[2px]">
          <div className="text-muted-foreground">estoque</div>
          <div className="num font-semibold">{fmtCompact(t.stock)}</div>
        </div>
      </div>
      <ul className="relative" style={{ height: H }} aria-label="Para onde foi o estoque do 1º turno">
        {laid.map((n) => {
          const mid = (n.y0 + n.y1) / 2;
          return (
            <li key={n.key} className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-2" style={{ top: Math.min(H - 16, Math.max(16, mid)) }}>
              {n.c ? <CandidateAvatar c={n.c} size="xs" /> : <span className="size-6 shrink-0 rounded-md border border-dashed" aria-hidden />}
              <div className="min-w-0 leading-tight">
                <div className="truncate text-[12px] text-muted-foreground">{n.label}</div>
                <div className="num text-[13px] font-semibold" style={n.c ? { color: n.c.color } : undefined}>
                  {fmtPct((n.value / total) * 100, 0)}%<span className="ml-1 text-[11px] font-normal text-muted-foreground">{fmtCompact(n.value)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
