// Peças pequenas usadas por chat, palpite, TV, embed e momento.
import type { CandidateDef, Moment } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { Bell, Calculator, CircleCheck, Flag, Repeat2, Zap, type LucideIcon } from 'lucide-react';
import { ogUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

/** porcentagem ao vivo com transição de dígitos (NumberFlow), sempre pt-BR */
export function Pct({
  v,
  digits = 1,
  suffix = '%',
  className,
}: {
  v: number;
  digits?: number;
  suffix?: string;
  className?: string;
}) {
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

export function Int({ v, className }: { v: number; className?: string }) {
  return <NumberFlow value={Math.round(v)} locales="pt-BR" className={cn('num', className)} />;
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
    <div className={cn('relative h-2 w-full overflow-hidden rounded-full bg-muted', className)} role="img" aria-label={`${ca.short} ${w.toFixed(1)}%, ${cb.short} ${(100 - w).toFixed(1)}%`}>
      <div className="absolute inset-y-0 left-0 transition-[width] duration-700 ease-out" style={{ width: `${w}%`, background: ca.color }} />
      <div className="absolute inset-y-0 right-0 transition-[width] duration-700 ease-out" style={{ width: `${100 - w}%`, background: cb.color }} />
      <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-background" />
      {marker != null && (
        <div
          className="absolute inset-y-0 w-1 -translate-x-1/2 rounded-full bg-foreground ring-2 ring-background"
          style={{ left: `${Math.max(0, Math.min(100, marker))}%` }}
          title={markerLabel}
        />
      )}
    </div>
  );
}

const ICONS: [RegExp, LucideIcon, string][] = [
  [/^🔔/u, Bell, 'Marco'],
  [/^⚡/u, Zap, 'Virada'],
  [/^🧮/u, Calculator, 'Definido'],
  [/^✅/u, CircleCheck, 'Totalizado'],
  [/^🏁/u, Flag, 'Cidade apurada'],
  [/^🔄/u, Repeat2, 'Virou de lado'],
];

/** Títulos de momento vêm com emoji na frente: trocamos por ícone (lucide) + rótulo. */
export function momentParts(title: string): { Icon: LucideIcon; kind: string; text: string } {
  for (const [re, Icon, kind] of ICONS) {
    if (re.test(title)) return { Icon, kind, text: title.replace(re, '').replace(/^️?\s*/, '').trim() };
  }
  return { Icon: Bell, kind: 'Apuração', text: title };
}

/** candidatos citados num texto (na ordem em que aparecem) */
export function mentioned(cands: CandidateDef[] | null | undefined, text: string): CandidateDef[] {
  if (!cands) return [];
  return cands
    .map((c) => ({ c, i: text.indexOf(c.short) }))
    .filter((x) => x.i >= 0)
    .sort((x, y) => x.i - y.i)
    .map((x) => x.c);
}

export function momentShare(m: Moment) {
  return {
    title: 'Apuração ao vivo',
    text: momentParts(m.title).text,
    url: `/m/${encodeURIComponent(m.id)}`,
    image: ogUrl.moment(m.id),
    filename: 'momento.png',
  };
}

export function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}
