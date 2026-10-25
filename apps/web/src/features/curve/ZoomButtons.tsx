// Botões de zoom dos gráficos da noite: −, + e "ver tudo" (só com zoom). Pequenos, sobre o canto do gráfico.
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { XZoom } from './zoom';

export function ZoomButtons({ z, className }: { z: XZoom; className?: string }) {
  const btn =
    'relative flex size-7 items-center justify-center rounded-full border bg-background/85 text-foreground shadow-sm backdrop-blur before:absolute before:-inset-1.5 hover:bg-accent disabled:opacity-40';
  return (
    <div className={cn('pointer-events-auto flex items-center gap-1', className)} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <button type="button" className={btn} onClick={z.zoomOut} disabled={!z.zoomed} aria-label="Afastar o gráfico">
        <Minus className="size-3.5" aria-hidden />
      </button>
      <button type="button" className={btn} onClick={z.zoomIn} aria-label="Aproximar o gráfico">
        <Plus className="size-3.5" aria-hidden />
      </button>
      {z.zoomed && (
        <button
          type="button"
          onClick={z.reset}
          className="relative h-7 rounded-full border bg-background/85 px-2.5 text-[11px] font-semibold shadow-sm backdrop-blur before:absolute before:-inset-y-1.5 before:inset-x-0 hover:bg-accent"
        >
          ver tudo
        </button>
      )}
    </div>
  );
}
