// Ficha de dado para tudo que é só visual (barras, faixas, quadradinhos): no computador abre ao passar o mouse,
// no celular ao tocar (toque fora fecha), no teclado com Tab + Enter. Regra do site: nenhum gráfico sem leitura.
import type { CandidateDef } from '@apuracao/shared';
import { Popover as P } from 'radix-ui';
import { useRef, useState, type ReactNode } from 'react';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DataTip({
  tip,
  label,
  children,
  className,
  side = 'top',
  nested = false,
}: {
  /** conteúdo da ficha */
  tip: ReactNode;
  /** o que a ficha mostra, numa frase (leitor de tela) */
  label: string;
  children: ReactNode;
  className?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  /**
   * dentro de um link ou botão (linha de estado/cidade): não vira um controle a mais (seria aninhado);
   * o texto vai para o nome acessível do pai e só o toque/mouse abrem a ficha
   */
  nested?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointer = useRef('mouse');
  const later = (v: boolean, ms: number) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(v), ms);
  };
  return (
    <P.Root open={open} onOpenChange={setOpen}>
      <P.Anchor asChild>
        <span
          ref={anchor}
          {...(nested ? {} : { role: 'button', tabIndex: 0, 'aria-label': label, 'aria-expanded': open })}
          className={cn('block cursor-help rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring', className)}
          onPointerDown={(e) => (pointer.current = e.pointerType)}
          onPointerEnter={(e) => e.pointerType === 'mouse' && later(true, 60)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && later(false, 80)}
          onClick={(e) => {
            // mouse: a ficha já abriu no hover e o clique segue (ex.: abrir o estado); toque: mostra a ficha
            if (pointer.current === 'mouse') return;
            e.preventDefault();
            e.stopPropagation();
            setOpen((o) => !o);
          }}
          onKeyDown={
            nested
              ? undefined
              : (e) => {
                  if (e.key === 'Escape') return setOpen(false);
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  setOpen((o) => !o);
                }
          }
          onBlur={() => setOpen(false)}
        >
          {children}
          {nested && <span className="sr-only">{label}</span>}
        </span>
      </P.Anchor>
      <P.Portal>
        <P.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          // tocar de novo na própria barra alterna (o clique dela decide); não fecha e reabre
          onInteractOutside={(e) => anchor.current?.contains(e.target as Node) && e.preventDefault()}
          onPointerEnter={(e) => e.pointerType === 'mouse' && timer.current && clearTimeout(timer.current)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && later(false, 80)}
          className="z-50 max-w-64 rounded-lg border bg-popover px-2.5 py-2 text-[12px] leading-snug text-popover-foreground shadow-lg outline-hidden data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          {tip}
          <P.Arrow className="fill-popover" width={10} height={5} />
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/** título opcional + uma linha por candidato: bolinha, nome e %; `extra` vai embaixo, apagado */
export function SplitTip({
  cands,
  pa,
  title,
  extra,
}: {
  cands: CandidateDef[];
  /** % de A (B é o complemento) */
  pa: number | null | undefined;
  title?: ReactNode;
  extra?: ReactNode;
}) {
  const [ca, cb] = cands;
  return (
    <div className="min-w-36">
      {title && <div className="mb-1 font-semibold">{title}</div>}
      {pa == null ? (
        <div className="text-muted-foreground">sem dado</div>
      ) : (
        (
          [
            [ca, pa],
            [cb, 100 - pa],
          ] as [CandidateDef, number][]
        ).map(([c, v]) => (
          <div key={c.key} className="num flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
              <span className="truncate">{c.short}</span>
            </span>
            <span className="font-semibold">{fmtPct(v, 1)}%</span>
          </div>
        ))
      )}
      {extra && <div className="num mt-1 text-[11px] text-muted-foreground">{extra}</div>}
    </div>
  );
}

/** frase curta de uma barra A|B (leitor de tela) */
export const splitLabel = (cands: CandidateDef[], pa: number | null | undefined, title?: string) =>
  `${title ? `${title}: ` : ''}${pa == null ? 'sem dado' : `${cands[0].short} ${fmtPct(pa, 1)}%, ${cands[1].short} ${fmtPct(100 - pa, 1)}%`}`;
