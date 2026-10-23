// Chips para mostrar/ocultar as referências (1º turno 2026, 2º turno 2022) nas linhas e no gráfico.
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRefs, type Refs } from './refs';

const ITEMS: { k: keyof Refs; label: string; hint: string }[] = [
  { k: 't1', label: '1º turno', hint: 'Mostrar o resultado do 1º turno de 2026 como referência' },
  { k: 'y22', label: '2022', hint: 'Mostrar o 2º turno de 2022 como referência' },
];

export function RefChips({ className, disabled }: { className?: string; disabled?: Partial<Record<keyof Refs, boolean>> }) {
  const [refs, set] = useRefs();
  return (
    <div className={cn('flex items-center gap-1.5', className)} role="group" aria-label="Referências">
      <span className="mr-0.5 text-[12px] text-muted-foreground">Comparar com</span>
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
              'press relative inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[12px] font-semibold transition-colors before:absolute before:-inset-y-1.5 before:inset-x-0 disabled:opacity-40',
              on ? 'border-foreground bg-foreground text-background' : 'bg-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {on && <Check className="size-3.5" aria-hidden />}
            {label}
          </button>
        );
      })}
    </div>
  );
}
