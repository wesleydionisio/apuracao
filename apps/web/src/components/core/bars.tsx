// Barras animadas sem animar width/left (gate 10a da Hallmark): o navegador não recalcula layout
// a cada quadro, só move ou recorta camadas. O trilho que as contém precisa de overflow-hidden.
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';

const clamp = (x: number) => Math.max(0, Math.min(100, x));

/** preenchimento de 0–100% num trilho: camada de largura total deslocada com translateX */
export function Fill({ pct, className, style }: { pct: number; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={cn('h-full w-full transition-transform duration-700 ease-out will-change-transform', className)}
      style={{ ...style, transform: `translateX(${clamp(pct) - 100}%)` }}
    />
  );
}

/**
 * Barra dividida A|B: duas camadas de largura total recortadas com clip-path,
 * com uma fresta de `gap` px entre as cores (o fundo do trilho aparece nela).
 */
export function SplitFill({ pa, colorA, colorB, gap = 0 }: { pa: number; colorA: string; colorB: string; gap?: number }) {
  const w = clamp(pa);
  const t = 'transition-[clip-path] duration-700 ease-out';
  return (
    <>
      <div className={cn('absolute inset-0', t)} style={{ background: colorA, clipPath: `inset(0 ${100 - w}% 0 0)` }} />
      <div className={cn('absolute inset-0', t)} style={{ background: colorB, clipPath: `inset(0 0 0 calc(${w}% + ${gap}px))` }} />
    </>
  );
}
