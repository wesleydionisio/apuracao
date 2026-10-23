// Peças pequenas do palpite (cópia local para não depender de outras telas).
import type { CandidateDef } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { SplitFill } from '@/components/core/bars';
import { DataTip, SplitTip, splitLabel } from '@/components/core/datatip';

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
    <DataTip
      className={className}
      label={`${splitLabel([ca, cb], w)}${marker != null && markerLabel ? `. ${markerLabel}` : ''}`}
      tip={<SplitTip cands={[ca, cb]} pa={w} extra={marker != null ? markerLabel ?? `${ca.short} ${fmtPct(marker, 1)}%` : undefined} />}
    >
    <div className="relative h-2 w-full rounded-full bg-muted" aria-hidden>
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <SplitFill pa={w} colorA={ca.color} colorB={cb.color} />
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-background" />
      </div>
      {marker != null && (
        <div
          className="absolute -inset-y-1 w-1 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-card"
          style={{ left: `${Math.max(0, Math.min(100, marker))}%` }}
        />
      )}
    </div>
    </DataTip>
  );
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
