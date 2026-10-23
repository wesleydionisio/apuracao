// Momentos da noite como timeline: hora, ícone por tipo, texto e compartilhar.
import type { Board, Moment } from '@apuracao/shared';
import { ArrowLeftRight, Building2, Calculator, CircleCheck, Flag, MapPin, Repeat2, type LucideIcon } from 'lucide-react';
import { Link } from 'wouter';
import { Card, Empty, ShareButton, Title } from '@/components/ui';
import { ogUrl } from '@/lib/api';
import { fmtHM } from '@/lib/format';
import { cn } from '@/lib/utils';

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

export function MomentsTimeline({ board, limit = 6 }: { board: Board; limit?: number }) {
  const list = board.moments.slice(0, limit);
  return (
    <Card>
      <Title right={board.moments.length > 0 && <span className="num text-[11px] text-muted-foreground">{board.moments.length} momentos</span>}>
        Momentos da noite
      </Title>
      {!list.length ? (
        <Empty title="Ainda nada por aqui">Marcos da apuração e viradas aparecem assim que acontecerem.</Empty>
      ) : (
        <ol className="relative" aria-live="polite">
          <span className="absolute top-2 bottom-2 left-[15px] w-px bg-border" aria-hidden />
          {list.map((m) => {
            const Icon = ICON[m.kind] ?? Flag;
            return (
              <li key={m.id} className="relative flex items-start gap-3 py-2">
                <span
                  className={cn(
                    'relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border bg-card',
                    strong(m.kind) && 'border-foreground bg-foreground text-background',
                  )}
                >
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <div className="min-w-0 flex-1 pt-0.5">
                  <div className="num text-[11px] text-muted-foreground">{fmtHM(m.at)}</div>
                  <Link href={`/m/${encodeURIComponent(m.id)}`} className={cn('mt-0.5 block text-[14px] leading-snug', strong(m.kind) && 'font-semibold')}>
                    {cleanTitle(m.title)}
                  </Link>
                </div>
                <ShareButton input={momentShare(m)} label="" variant="ghost" className="-mr-2" />
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
