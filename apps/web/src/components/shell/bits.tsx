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

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn('size-6', className)} aria-hidden>
      <rect width="24" height="24" rx="6" className="fill-foreground" />
      <rect x="5" y="13" width="3.2" height="6" rx="1" className="fill-background" />
      <rect x="10.4" y="8.5" width="3.2" height="10.5" rx="1" className="fill-background" opacity=".55" />
      <rect x="15.8" y="5" width="3.2" height="14" rx="1" className="fill-background" />
    </svg>
  );
}

export function LegalFooter() {
  return (
    <footer className="mt-10 space-y-3 border-t pt-5 pb-2 text-[12px] leading-relaxed text-muted-foreground">
      <div className="flex items-center gap-2 text-foreground">
        <Logo className="size-5" />
        <span className="text-[13px] font-semibold">Apuração ao vivo</span>
      </div>
      <p>
        Projeto independente, sem vínculo com o TSE, partidos ou candidatos. Fonte única: TSE. Projeções são estimativas e
        sempre aparecem com o percentual apurado; o resultado oficial é o da totalização do TSE.
      </p>
      <p>
        Chat: seja gentil. Sem links, ofensas ou ameaças; mensagens de até 240 caracteres. Para escrever, entre com o Google.
        No chat aparece só o seu nome de usuário. Mensagens podem ser removidas após denúncias.
      </p>
      <nav className="flex flex-wrap gap-x-4 gap-y-1 font-medium text-foreground/80" aria-label="Outros formatos">
        <Link href="/tv" className="inline-flex min-h-11 items-center hover:text-foreground">
          Modo TV
        </Link>
        <a href="/embed/placar" className="inline-flex min-h-11 items-center hover:text-foreground">
          Embed para portais
        </a>
        <a href="https://resultados.tse.jus.br/" target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center hover:text-foreground">
          Resultados no TSE
        </a>
        <Link href="/privacidade" className="inline-flex min-h-11 items-center hover:text-foreground">
          Privacidade
        </Link>
        <Link href="/termos" className="inline-flex min-h-11 items-center hover:text-foreground">
          Termos
        </Link>
      </nav>
    </footer>
  );
}
