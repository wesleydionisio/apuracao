// Peças pequenas do palpite (cópia local para não depender de outras telas).
import type { CandidateDef } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { cn } from '@/lib/utils';

/** porcentagem ao vivo com transição de dígitos (NumberFlow), sempre pt-BR */
export function Pct({ v, digits = 1, suffix = '%', className }: { v: number; digits?: number; suffix?: string; className?: string }) {
  return (
    <NumberFlow
      value={v}
      locales="pt-BR"
      format={{ minimumFractionDigits: digits, maximumFractionDigits: digits }}
      suffix={suffix}
      className={cn('num', className)}
      willChange
    />
  );
}

/**
 * Barra A × B com a marca dos 50% (a linha de chegada).
 * `marker` desenha um tique extra (ex.: o parcial atual sobre um palpite).
 */
export function SplitBar({
  pa,
  ca,
  cb,
  className,
  marker,
  markerLabel,
}: {
  pa: number;
  ca: CandidateDef;
  cb: CandidateDef;
  className?: string;
  marker?: number | null;
  markerLabel?: string;
}) {
  const w = Math.max(0, Math.min(100, pa));
  return (
    <div className={cn('relative h-2 w-full rounded-full bg-muted', className)} role="img" aria-label={`${ca.short} ${w.toFixed(1)}%, ${cb.short} ${(100 - w).toFixed(1)}%`}>
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <div className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out" style={{ width: `${w}%`, background: ca.color }} />
        <div className="absolute inset-y-0 right-0 transition-[width] duration-700 ease-out" style={{ width: `${100 - w}%`, background: cb.color }} />
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-background" />
      </div>
      {marker != null && (
        <div
          className="absolute -inset-y-1 w-1 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card transition-[left] duration-700 ease-out"
          style={{ left: `${Math.max(0, Math.min(100, marker))}%` }}
          title={markerLabel}
        />
      )}
    </div>
  );
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
