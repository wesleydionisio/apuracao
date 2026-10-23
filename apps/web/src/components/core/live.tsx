// Sinais de "ao vivo" e de procedência dos dados (obrigatórios em toda tela).
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { fmtBrt, fmtPct } from '@apuracao/shared';
import { cn } from '@/lib/utils';
import { TSE_URL } from '@/lib/env';
import type { LinkStatus } from '@/store/board';

const LINK: Record<LinkStatus, { label: string; tone: string; ping: boolean }> = {
  live: { label: 'Ao vivo', tone: 'bg-live', ping: true },
  connecting: { label: 'Conectando', tone: 'bg-muted-foreground', ping: false },
  reconnecting: { label: 'Reconectando', tone: 'bg-warning', ping: false },
  offline: { label: 'Atualizando a cada 10s', tone: 'bg-muted-foreground', ping: false },
  demo: { label: 'Demo', tone: 'bg-warning', ping: false },
};

export function LiveDot({ link, className }: { link: LinkStatus; className?: string }) {
  const l = LINK[link];
  return (
    <span className={cn('relative inline-flex size-2', className)} aria-hidden>
      {l.ping && <span className={cn('live-ping absolute inset-0 rounded-full', l.tone)} />}
      <span className={cn('relative inline-flex size-2 rounded-full', l.tone)} />
    </span>
  );
}

export function LivePill({ link, className }: { link: LinkStatus; className?: string }) {
  return (
    <span
      className={cn('inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground', className)}
      role="status"
      aria-live="polite"
    >
      <LiveDot link={link} />
      {LINK[link].label}
    </span>
  );
}

/** "Dados oficiais do TSE · 18:42:10" — link obrigatório com a hora da última atualização */
export function SourceStamp({ at, className, short = false }: { at?: string | null; className?: string; short?: boolean }) {
  return (
    <a
      href={TSE_URL}
      target="_blank"
      rel="noreferrer"
      className={cn('inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground', className)}
    >
      <span className="underline decoration-border underline-offset-2">{short ? 'TSE' : 'Dados oficiais do TSE'}</span>
      {at && <span className="num">· {fmtBrt(at, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>}
    </a>
  );
}

/** variação em pontos percentuais: ▲ 0,4 / ▼ 1,2 — nunca usa só cor */
export function Delta({ v, digits = 1, className, suffix = '' }: { v: number | null | undefined; digits?: number; className?: string; suffix?: string }) {
  if (v === null || v === undefined || Math.abs(v) < 10 ** -digits / 2) {
    return <span className={cn('num text-xs text-muted-foreground', className)}>=</span>;
  }
  const up = v > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={cn('num inline-flex items-center gap-0.5 text-xs font-medium', up ? 'text-live' : 'text-destructive', className)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{up ? 'subiu' : 'caiu'}</span>
      {fmtPct(Math.abs(v), digits)}
      {suffix}
    </span>
  );
}
