// Amostra do traço de cada camada (hoje, projeção, 2022, 1º turno), para chips e legendas: igual ao que está no gráfico.
import type { CandidateDef } from '@apuracao/shared';
import { cn } from '@/lib/utils';
import { LAYER } from './layers';

export type LayerKey = 'hoje' | 'proj' | 'y22' | 't1';

export function Swatch({ k, cands, className }: { k: LayerKey; cands: CandidateDef[]; className?: string }) {
  const [ca, cb] = cands;
  return (
    <svg width={18} height={10} viewBox="0 0 18 10" className={cn('shrink-0', className)} aria-hidden>
      {k === 'hoje' && (
        <>
          <line x1={1} x2={17} y1={3} y2={3} stroke={cb.color} strokeWidth={2} strokeLinecap="round" />
          <line x1={1} x2={17} y1={7} y2={7} stroke={ca.color} strokeWidth={2} strokeLinecap="round" />
        </>
      )}
      {k === 'proj' && (
        <>
          <rect x={0} y={1} width={18} height={8} rx={2} fill={ca.color} fillOpacity={0.16} />
          <line x1={2} x2={17} y1={5} y2={5} stroke={ca.color} strokeWidth={2} strokeLinecap="round" strokeDasharray="0.1 4" />
        </>
      )}
      {k === 'y22' && <line x1={0} x2={18} y1={5} y2={5} stroke={LAYER.y22.color} strokeWidth={2} strokeDasharray="5 3" />}
      {k === 't1' && <line x1={0} x2={18} y1={5} y2={5} stroke={LAYER.t1.color} strokeWidth={2} strokeDasharray="6 2 2 2" />}
    </svg>
  );
}
