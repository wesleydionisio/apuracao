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
      // largura do rótulo mais longo ("Reconectando…"): trocar de estado não empurra o título do cabeçalho
      className={cn('inline-flex min-w-[6.75rem] items-center justify-end gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground', className)}
      role="status"
      aria-live="polite"
    >
      <LiveDot link={link} />
      {LINK[link].label}
    </span>
  );
}

/** placar parado há mais de 90 s neste aparelho: diz de quando é, em vez de "Ao vivo" */
export function StalePill({ at, className }: { at: string; className?: string }) {
  return (
    <span
      className={cn('inline-flex min-w-[6.75rem] items-center justify-end gap-1.5 text-xs font-medium whitespace-nowrap text-muted-foreground', className)}
      role="status"
      aria-live="polite"
    >
      <span className="relative inline-flex size-2 rounded-full bg-warning" aria-hidden />
      <span className="num">Placar das {fmtBrt(at, { hour: '2-digit', minute: '2-digit' })}</span>
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

/** a votação foi prorrogada no próprio domingo: por que a contagem mudou de 17h para 19h, com a fonte */
export const EXTENSION_URL = 'https://g1.globo.com/politica/eleicoes/2026/noticia/2026/10/25/zanin-prorroga-votacao.ghtml';

export function ExtensionNotice({ className }: { className?: string }) {
  return (
    <p className={cn('rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[12.5px] leading-snug text-foreground', className)}>
      <strong className="font-semibold">Votação prorrogada até as 19h</strong> em todo o país, por decisão do ministro Cristiano Zanin, do STF.{' '}
      <a href={EXTENSION_URL} target="_blank" rel="noreferrer" className="whitespace-nowrap text-muted-foreground underline decoration-border underline-offset-2 hover:text-foreground">
        Fonte: g1
      </a>
    </p>
  );
}

/** variação em pontos percentuais: ↗ 0,4 / ↘ 1,2 — direção pela seta, nunca pela cor */
export function Delta({ v, digits = 1, className, suffix = '' }: { v: number | null | undefined; digits?: number; className?: string; suffix?: string }) {
  if (v === null || v === undefined || Math.abs(v) < 10 ** -digits / 2) {
    return <span className={cn('num text-xs text-muted-foreground', className)}>=</span>;
  }
  const up = v > 0;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    // neutro de propósito: verde/vermelho aqui confundiria com as cores dos candidatos
    <span className={cn('num inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground', className)}>
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{up ? 'subiu' : 'caiu'}</span>
      {fmtPct(Math.abs(v), digits)}
      {suffix}
    </span>
  );
}
