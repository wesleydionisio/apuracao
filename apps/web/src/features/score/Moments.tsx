// Momentos da noite como timeline: hora à esquerda, ícone por tipo sobre a linha do tempo, texto e compartilhar.
import type { Board, Moment } from '@apuracao/shared';
import { ArrowLeftRight, Building2, Calculator, ChevronDown, CircleCheck, Flag, History, MapPin, Repeat2, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'wouter';
import { Empty, ShareButton } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { ogUrl } from '@/lib/api';
import { fmtHM } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from './Section';

const ICON: Record<Moment['kind'], LucideIcon> = {
  milestone: Flag,
  virada: ArrowLeftRight,
  uf_milestone: MapPin,
  virada_uf: Repeat2,
  definido: Calculator,
  totalizado: CircleCheck,
  mun_final: Building2,
  mun_flip: Repeat2,
};

const KIND: Record<Moment['kind'], string> = {
  milestone: 'Marco',
  virada: 'Virada',
  uf_milestone: 'Estado',
  virada_uf: 'Virada no estado',
  definido: 'Definido',
  totalizado: 'Totalizado',
  mun_final: 'Cidade apurada',
  mun_flip: 'Virou de lado',
};

/** os títulos do poller começam com emoji; aqui o ícone já faz esse papel */
export const cleanTitle = (t: string) => t.replace(/^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\s]+/u, '');

export function momentShare(m: Moment) {
  return {
    title: 'Apuração ao vivo',
    text: m.title,
    url: `/m/${encodeURIComponent(m.id)}`,
    image: ogUrl.moment(m.id),
    filename: 'momento.png',
  };
}

const strong = (k: Moment['kind']) => k === 'virada' || k === 'definido' || k === 'totalizado';

export function MomentsTimeline({ board, limit = 6, className }: { board: Board; limit?: number; className?: string }) {
  const [more, setMore] = useState(false);
  const list = board.moments.slice(0, more ? 40 : limit);
  return (
    <Section
      icon={History}
      title="Momentos da noite"
      meta={board.moments.length > 0 && <span className="num">{board.moments.length}</span>}
      className={className}
    >
      {!list.length ? (
        <Empty title="Ainda nada por aqui">Marcos da apuração, viradas e cidades grandes apuradas aparecem aqui assim que acontecem.</Empty>
      ) : (
        <>
          <ol className="relative" aria-live="polite">
            {/* trilho da timeline, alinhado ao centro dos ícones */}
            <span className="absolute top-3 bottom-3 left-[4.25rem] w-px bg-border" aria-hidden />
            {list.map((m) => {
              const Icon = ICON[m.kind] ?? Flag;
              return (
                <li key={m.id} className="relative grid grid-cols-[2.75rem_2rem_minmax(0,1fr)_auto] items-start gap-x-2 py-1.5">
                  <span className="num pt-2 text-right text-[11px] text-muted-foreground">{fmtHM(m.at)}</span>
                  <span
                    className={cn(
                      'relative z-10 mt-0.5 flex size-8 items-center justify-center rounded-full border bg-card',
                      strong(m.kind) && 'border-foreground bg-foreground text-background',
                    )}
                  >
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <div className="text-[11px] text-muted-foreground">{KIND[m.kind]}</div>
                    <Link
                      href={`/m/${encodeURIComponent(m.id)}`}
                      className={cn('block text-[14px] leading-snug hover:underline', strong(m.kind) && 'font-semibold')}
                    >
                      {cleanTitle(m.title)}
                    </Link>
                  </div>
                  <ShareButton input={momentShare(m)} label="" variant="ghost" className="-mr-2" />
                </li>
              );
            })}
          </ol>
          {board.moments.length > limit && (
            <Button variant="ghost" className="mt-1 h-11 w-full text-[13px] text-muted-foreground" onClick={() => setMore((v) => !v)}>
              {more ? 'Mostrar menos' : `Ver todos os ${board.moments.length}`}
              <ChevronDown className={cn('size-4 transition-transform', more && 'rotate-180')} aria-hidden />
            </Button>
          )}
        </>
      )}
    </Section>
  );
}
