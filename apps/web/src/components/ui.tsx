import { useEffect, useRef, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { TSE_URL } from '../lib/env';
import { fmtTime } from '../lib/format';
import { prefetchImage, share, type ShareInput } from '../lib/share';
import { useBoard } from '../store/board';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`surface rounded-2xl p-4 ${className}`}>{children}</section>;
}

export function Title({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="text-[15px] font-semibold leading-tight">{children}</h2>
      {right}
    </div>
  );
}

export function Chip({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'warn' | 'live' }) {
  const cls =
    tone === 'warn'
      ? 'bg-warn/15 text-warn'
      : tone === 'live'
        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
        : 'bg-soft text-muted';
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

/** Rótulo obrigatório de toda projeção */
export function Estimate({ pst }: { pst: number }) {
  return (
    <Chip tone="warn">
      estimativa com {pst.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}% apurado
    </Chip>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mt-1 text-[13px] text-muted">{children}</p>}
    </div>
  );
}

export function Skeleton({ h = 80 }: { h?: number }) {
  return <div className="animate-pulse rounded-2xl bg-soft" style={{ height: h }} />;
}

/** "dados oficiais do TSE · atualizado às hh:mm:ss" — vai em toda tela */
export function TseLink({ className = '' }: { className?: string }) {
  const at = useBoard((s) => s.board?.source.at);
  return (
    <span className={`text-[11px] text-muted ${className}`}>
      <a href={TSE_URL} target="_blank" rel="noopener" className="underline underline-offset-2">
        Dados oficiais do TSE
      </a>
      {at ? <>, atualizados às <span className="num">{fmtTime(at)}</span></> : null}
    </span>
  );
}

// ------------------------------------------------------------------ toast

const useToast = create<{ msg: string | null; k: number }>(() => ({ msg: null, k: 0 }));
export const toast = (msg: string) => useToast.setState({ msg, k: Date.now() });

export function Toaster() {
  const { msg, k } = useToast();
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => useToast.setState({ msg: null }), 2600);
    return () => clearTimeout(t);
  }, [k, msg]);
  if (!msg) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-4"
      style={{ bottom: 'calc(var(--tabbar-h) + env(safe-area-inset-bottom) + 16px)' }}
    >
      <div key={k} className="toast-in rounded-full bg-fg px-4 py-2 text-sm text-bg shadow-[var(--shadow-md)]">{msg}</div>
    </div>
  );
}

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
  const base =
    variant === 'solid'
      ? 'bg-fg text-bg'
      : 'border border-line bg-card text-fg';
  return (
    <button
      type="button"
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
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold press disabled:opacity-60 ${base} ${className}`}
    >
      <ShareIcon />
      {label}
    </button>
  );
}

export function ShareIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
    return () => io.disconnect();
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
