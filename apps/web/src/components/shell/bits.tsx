// Peças pequenas do shell reaproveitadas por várias telas.
import type { Board } from '@apuracao/shared';
import { Link } from 'wouter';
import { cn } from '@/lib/utils';

export function countdownParts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const two = (n: number) => String(n).padStart(2, '0');

export function fmtCountdown(ms: number) {
  const p = countdownParts(ms);
  return `${p.d ? `${p.d}d ` : ''}${two(p.h)}:${two(p.m)}:${two(p.s)}`;
}

/** Barra A×B com a marca dos 50% (a linha de chegada). */
export function SplitBar({ b, h = 8, className }: { b: Board; h?: number; className?: string }) {
  const ca = b.candidates[0];
  const cb = b.candidates[1];
  const pa = b.br?.valid ? b.br.pa : 50;
  return (
    <div
      className={cn('relative flex w-full gap-[2px] overflow-hidden rounded-full', className)}
      style={{ height: h }}
      role="img"
      aria-label={`${ca.short} ${pa.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%, ${cb.short} ${(100 - pa).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
    >
      <div className="h-full rounded-l-full transition-[flex-basis] duration-700 ease-out" style={{ flexBasis: `${pa}%`, background: ca.color }} />
      <div className="h-full flex-1 rounded-r-full transition-[flex-basis] duration-700 ease-out" style={{ background: cb.color }} />
      <div className="absolute inset-y-[-2px] left-1/2 w-[2px] -translate-x-1/2 bg-background" aria-hidden />
    </div>
  );
}

/** Marca Urna.digi: urna com a cédula entrando, só traço em currentColor (branca no escuro, grafite no claro). */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn('size-6 shrink-0', className)}
      aria-hidden
    >
      <path d="M7.5 11V4.5C7.5 3.67 8.17 3 9 3h6c.83 0 1.5.67 1.5 1.5V11" />
      <path d="m10 7.2 1.5 1.5 2.7-2.9" />
      <rect x="3" y="11" width="18" height="10" rx="2.5" />
    </svg>
  );
}

/** Rodapé enxuto: marca, uma linha de aviso e os links legais. */
export function LegalFooter() {
  return (
    <footer className="mt-10 border-t pt-4 pb-2 text-[12px] leading-relaxed text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <div className="flex items-center gap-2 text-foreground">
          <Logo className="size-5" />
          <span className="text-[13px] font-semibold tracking-[-0.01em]">Urna.digi</span>
        </div>
        <nav className="flex gap-4 font-medium text-foreground/80" aria-label="Informações legais">
          <Link href="/privacidade" className="inline-flex min-h-11 items-center hover:text-foreground">
            Privacidade
          </Link>
          <Link href="/termos" className="inline-flex min-h-11 items-center hover:text-foreground">
            Termos
          </Link>
        </nav>
      </div>
      <p>Projeto independente, sem vínculo com o TSE. Dados oficiais do TSE; projeções são estimativas.</p>
    </footer>
  );
}
