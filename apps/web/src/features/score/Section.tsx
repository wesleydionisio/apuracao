// Seção da folha de análise: divisória fina em cima, ícone + título + meta, sem caixa em volta.
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Section({
  icon: Icon,
  title,
  meta,
  children,
  className,
  id,
}: {
  icon?: LucideIcon;
  title: string;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const hid = id ? `${id}-h` : undefined;
  return (
    <section id={id} aria-labelledby={hid} className={cn('border-t py-5', className)}>
      <header className="mb-3.5 flex min-h-6 items-center justify-between gap-3">
        <h2 id={hid} className="flex min-w-0 items-center gap-2 text-[15px] leading-tight font-semibold tracking-[-0.01em]">
          {Icon && <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="truncate">{title}</span>
        </h2>
        {meta && <div className="shrink-0 text-[12px] text-muted-foreground">{meta}</div>}
      </header>
      {children}
    </section>
  );
}

/** Esqueleto com a forma da seção (título + corpo na altura certa) — nada de buraco enquanto carrega */
export function SectionSkeleton({ h = 160, className }: { h?: number; className?: string }) {
  return (
    <div className={cn('border-t py-5', className)} aria-hidden>
      <div className="mb-3.5 h-5 w-40 animate-pulse rounded-md bg-muted" />
      <div className="animate-pulse rounded-lg bg-muted/60" style={{ height: h }} />
    </div>
  );
}

/** pílula de meta discreta (ex.: "vs 1º turno") */
export function MetaPill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-full px-2 text-[11px] font-medium',
        tone === 'muted' ? 'bg-muted text-muted-foreground' : 'bg-warning/12 text-warning',
      )}
    >
      {children}
    </span>
  );
}
