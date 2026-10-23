import { Maximize2, Minus, Plus } from 'lucide-react';

/**
 * +, − e "Brasil inteiro" no canto de baixo à esquerda: lá o enquadramento do Brasil é vazio (Paraguai/Argentina).
 * Alvo de 44px, botão visível de 32px.
 */
export function ZoomControls({ zoomed, onIn, onOut, onReset }: { zoomed: boolean; onIn: () => void; onOut: () => void; onReset: () => void }) {
  const btn = 'group grid size-11 place-items-center disabled:pointer-events-none';
  const face =
    'grid size-8 place-items-center rounded-lg border bg-card/90 text-foreground shadow-sm backdrop-blur-sm transition-opacity group-active:scale-95 group-disabled:opacity-40';
  return (
    <div className="absolute bottom-0 left-0 flex flex-col" role="group" aria-label="Zoom do mapa">
      <button type="button" className={btn} onClick={onIn} aria-label="Aproximar">
        <span className={face}>
          <Plus className="size-4" aria-hidden />
        </span>
      </button>
      <button type="button" className={btn} onClick={onOut} disabled={!zoomed} aria-label="Afastar">
        <span className={face}>
          <Minus className="size-4" aria-hidden />
        </span>
      </button>
      <button type="button" className={btn} onClick={onReset} disabled={!zoomed} aria-label="Ver o mapa inteiro">
        <span className={face}>
          <Maximize2 className="size-3.5" aria-hidden />
        </span>
      </button>
    </div>
  );
}
