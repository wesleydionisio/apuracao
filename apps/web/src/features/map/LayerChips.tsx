// Camada do mapa (uma por vez): Agora, 1º turno, 2022 — os mesmos chips dos gráficos, com a amostra de cada camada.
import type { CandidateDef } from '@apuracao/shared';
import { chipClass, Swatch } from '@/features/curve/Swatch';
import { cn } from '@/lib/utils';
import type { MapLayer } from './data';

const ITEMS: { k: MapLayer; sw: 'hoje' | 't1' | 'y22'; label: string; hint: string }[] = [
  { k: 'live', sw: 'hoje', label: 'Agora', hint: 'A parcial de agora' },
  { k: 't1', sw: 't1', label: '1º turno', hint: 'O 1º turno de 2026, só os dois finalistas' },
  { k: 'y2022', sw: 'y22', label: '2022', hint: 'O 2º turno de 2022' },
];

export function LayerChips({
  value,
  onChange,
  cands,
  live,
  who22,
  label = 'Mostrar',
  className,
}: {
  value: MapLayer;
  onChange: (v: MapLayer) => void;
  cands: CandidateDef[];
  /** a apuração já começou (sem ela, "Agora" não aparece) */
  live: boolean;
  /** "Lula × Jair Bolsonaro", para a dica do chip de 2022 */
  who22?: string;
  label?: string | null;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="radiogroup" aria-label="Camada do mapa">
      {label && <span className="mr-0.5 text-[12px] text-muted-foreground">{label}</span>}
      {ITEMS.filter((i) => live || i.k !== 'live').map(({ k, sw, label: l, hint }) => {
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            title={k === 'y2022' && who22 ? `${hint}: ${who22}` : hint}
            onClick={() => onChange(k)}
            className={chipClass(on)}
          >
            <Swatch k={sw} cands={cands} className={cn('transition-opacity', !on && 'opacity-40')} />
            {l}
          </button>
        );
      })}
    </div>
  );
}
