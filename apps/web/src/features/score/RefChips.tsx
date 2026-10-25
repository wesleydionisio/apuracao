// Chips para mostrar/ocultar as camadas: projeção no gráfico, 1º turno 2026 e 2º turno 2022 (nas linhas e no gráfico).
// Cada chip leva a amostra do próprio traço, igual ao desenhado no gráfico.
import type { CandidateDef } from '@apuracao/shared';
import { Swatch } from '@/features/curve/Swatch';
import { cn } from '@/lib/utils';
import { useRefs, type Refs } from './refs';

const ITEMS: { k: keyof Refs; label: string; hint: string }[] = [
  { k: 'proj', label: 'Projeção', hint: 'Mostrar no gráfico a projeção até 100%, com a faixa de 95%' },
  { k: 't1', label: '1º turno', hint: 'Mostrar o resultado do 1º turno de 2026 como referência' },
  { k: 'y22', label: '2022', hint: 'Mostrar o 2º turno de 2022 (Lula × Jair Bolsonaro) como referência' },
];

export function RefChips({
  cands,
  className,
  disabled,
}: {
  cands: CandidateDef[];
  className?: string;
  disabled?: Partial<Record<keyof Refs, boolean>>;
}) {
  const [refs, set] = useRefs();
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)} role="group" aria-label="Camadas do gráfico">
      <span className="mr-0.5 text-[12px] text-muted-foreground">Mostrar</span>
      {ITEMS.map(({ k, label, hint }) => {
        const on = refs[k];
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            title={hint}
            disabled={disabled?.[k]}
            onClick={() => set({ [k]: !on })}
            className={cn(
              // alvo de toque de 44px sem engordar o chip
              'press relative inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12px] font-semibold transition-colors before:absolute before:-inset-y-1.5 before:inset-x-0 disabled:opacity-40',
              on ? 'border-foreground/50 bg-accent text-foreground' : 'bg-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <Swatch k={k} cands={cands} className={cn('transition-opacity', !on && 'opacity-40')} />
            {label}
          </button>
        );
      })}
    </div>
  );
}
