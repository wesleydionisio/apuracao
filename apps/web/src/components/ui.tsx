// Primitivas compartilhadas do app (sobre os componentes shadcn). Os nomes são estáveis:
// várias telas importam daqui.
import { Share2 } from 'lucide-react';
import { lazy, useEffect, useRef, useState, type ReactNode } from 'react';
import { SourceStamp } from '@/components/core/live';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton as Shimmer } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { prefetchImage, share, type ShareInput } from '../lib/share';
import { useBoard } from '../store/board';

/** Superfície padrão: cartão discreto, borda sutil, sem sombra pesada. */
export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={cn('rounded-xl border bg-card p-4 text-card-foreground', className)}>{children}</section>;
}

/** Título de bloco: 15px semibold + ação/meta à direita */
export function Title({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex min-h-6 items-center justify-between gap-3">
      <h2 className="text-[15px] leading-tight font-semibold tracking-[-0.01em]">{children}</h2>
      {right}
    </div>
  );
}

export function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'live' }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'h-6 rounded-full px-2 text-[11px] font-medium',
        tone === 'warn' && 'bg-warning/12 text-warning',
        tone === 'live' && 'bg-live/12 text-live',
        tone === 'muted' && 'text-muted-foreground',
      )}
    >
      {tone === 'live' && <span className="size-1.5 rounded-full bg-live" aria-hidden />}
      {children}
    </Badge>
  );
}

/** Rótulo obrigatório de toda projeção */
export function Estimate({ pst }: { pst: number }) {
  return <Chip tone="warn">estimativa · {pst.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% apurado</Chip>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{children}</p>}
    </div>
  );
}

export function Skeleton({ h = 80, className }: { h?: number; className?: string }) {
  return <Shimmer className={cn('w-full rounded-xl', className)} style={{ height: h }} />;
}

/** "Dados oficiais do TSE · hh:mm:ss" — vai em toda tela */
export function TseLink({ className = '' }: { className?: string }) {
  const at = useBoard((s) => s.board?.source.at);
  return <SourceStamp at={at} className={className} />;
}

// ------------------------------------------------------------------ toast (sonner)

// sonner fica fora do bundle inicial: carrega no primeiro toast (e o Toaster é lazy no App)
export const toast = (msg: string) => {
  void import('sonner').then((m) => m.toast(msg));
};
export const Toaster = lazy(() => import('@/components/ui/sonner').then((m) => ({ default: m.Toaster })));

// ------------------------------------------------------------------ compartilhar

export function ShareButton({
  input,
  label = 'Compartilhar',
  variant = 'solid',
  className = '',
}: {
  input: ShareInput;
  label?: string;
  variant?: 'solid' | 'ghost';
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const iconOnly = !label;
  return (
    <Button
      type="button"
      variant={variant === 'solid' ? 'default' : iconOnly ? 'ghost' : 'outline'}
      size={iconOnly ? 'icon' : 'default'}
      aria-label={label || 'Compartilhar'}
      disabled={busy}
      onPointerDown={() => prefetchImage(input.image)}
      onClick={async () => {
        setBusy(true);
        const r = await share(input);
        setBusy(false);
        if (r === 'copied') toast('Link copiado — cole no WhatsApp');
        else if (r === 'failed') toast('Não deu para compartilhar daqui');
      }}
      className={cn('press', iconOnly ? 'size-11 rounded-full text-muted-foreground' : 'h-11 rounded-xl px-4', className)}
    >
      <Share2 className="size-4" aria-hidden />
      {label}
    </Button>
  );
}

export function ShareIcon() {
  return <Share2 className="size-4" aria-hidden />;
}

// ------------------------------------------------------------------ lazy por visibilidade

/** Só monta os filhos quando o bloco chega perto da tela (economiza JS/dados no celular). */
export function WhenVisible({ children, h = 200 }: { children: ReactNode; h?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || on) return;
    if (!('IntersectionObserver' in window)) return setOn(true);
    // rede de segurança: há navegadores/abas em que o observer nunca dispara — monta assim mesmo
    const t = setTimeout(() => setOn(true), 2500);
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px' },
    );
    io.observe(el);
    return () => {
      clearTimeout(t);
      io.disconnect();
    };
  }, [on]);
  return <div ref={ref}>{on ? children : <Skeleton h={h} />}</div>;
}

export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
