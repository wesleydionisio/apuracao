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

/** Marca urna.digi: urna com a cédula entrando, só traço em currentColor (branca no escuro, grafite no claro). */
/** Marca: só o nome, em bold minúsculo (sem ícone). O tamanho vem do texto em volta ou do className. */
export function Logo({ className }: { className?: string }) {
  return <span className={cn('shrink-0 font-bold tracking-[-0.035em] lowercase', className)}>urna.digi</span>;
}

/** Rodapé enxuto: marca, uma linha de aviso e os links legais. */
export function LegalFooter() {
  return (
    <footer className="mt-10 border-t pt-4 pb-2 text-[12px] leading-relaxed text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <Logo className="text-[14px] text-foreground" />
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
