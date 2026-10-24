// /m/:id — um momento da apuração como página compartilhável.
import { ufName } from '@apuracao/shared';
import { ArrowRight, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { Empty, Skeleton, toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { ogUrl } from '@/lib/api';
import { fmtHM, fmtPct } from '@/lib/format';
import { prefetchImage, share } from '@/lib/share';
import { useBoard } from '@/store/board';
import { mentioned, momentParts, momentShare, SplitBar } from './bits';
import { MomentSkeleton } from '@/components/skeletons';

const scopeName = (s: string) => (s === 'br' ? 'Brasil' : s.startsWith('uf:') ? ufName(s.slice(3)) : 'Município');

export function MomentPage() {
  const board = useBoard((s) => s.board);
  const { id } = useParams<{ id: string }>();
  const [noImg, setNoImg] = useState(false);
  if (!board) return <MomentSkeleton />;
  const m = board.moments.find((x) => x.id === decodeURIComponent(id ?? ''));
  if (!m)
    return (
      <div className="space-y-3 pt-2">
        <Empty title="Momento não encontrado">Ele pode ser de outra parte da noite. O placar ao vivo está a um toque.</Empty>
        <Button asChild size="lg" className="h-12 w-full rounded-xl">
          <Link href="/">Ver placar ao vivo</Link>
        </Button>
      </div>
    );
  const { Icon, kind, text } = momentParts(m.title);
  const who = mentioned(board.candidates, text);
  const snap = m.scope === 'br' ? board.br : (board.ufs[m.scope] ?? null);
  const [ca, cb] = board.candidates;
  const input = momentShare(m);
  return (
    <div className="space-y-3 pt-1">
      <article className="overflow-hidden rounded-2xl border bg-card">
        <div className="px-5 pt-5 pb-5">
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 font-medium text-foreground">
              <Icon className="size-3.5" aria-hidden />
              {kind}
            </span>
            <span>{scopeName(m.scope)}</span>
            <span aria-hidden>·</span>
            <span className="num">{fmtHM(m.at)}</span>
          </div>
          <h1 className="mt-4 text-[24px] leading-[1.15] font-semibold tracking-tight text-balance">{text}</h1>
          {who.length > 0 && (
            <div className="mt-4 flex items-center gap-2">
              {who.map((c) => (
                <span key={c.key} className="inline-flex items-center gap-2 rounded-full border py-1 pr-3 pl-1 text-[13px] font-medium">
                  <CandidateAvatar c={c} size="xs" className="rounded-full" />
                  {c.short}
                </span>
              ))}
            </div>
          )}
        </div>
        {snap && snap.valid > 0 && (
          <div className="border-t bg-muted/40 px-5 py-4">
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>{scopeName(m.scope)} agora</span>
              <span className="num">{fmtPct(snap.pst, 1)}% apurado</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[15px] font-semibold">
              <span className="num text-cand-a">{fmtPct(snap.pa, 2)}%</span>
              <span className="num text-cand-b">{fmtPct(snap.pb, 2)}%</span>
            </div>
            <SplitBar pa={snap.pa} ca={ca} cb={cb} className="mt-1.5 h-1.5" />
          </div>
        )}
      </article>

      {!noImg && (
        <img
          src={ogUrl.moment(m.id)}
          alt="Prévia da imagem que será compartilhada"
          width={1200}
          height={630}
          loading="eager"
          onError={() => setNoImg(true)}
          className="aspect-[1200/630] w-full rounded-2xl border bg-muted object-cover"
        />
      )}
      <Button
        size="lg"
        className="h-12 w-full rounded-xl text-[15px]"
        onPointerDown={() => prefetchImage(input.image)}
        onClick={async () => {
          const r = await share(input);
          if (r === 'copied') toast('Link copiado. Cole no WhatsApp');
          else if (r === 'failed') toast('Não deu para compartilhar daqui');
        }}
      >
        <Share2 className="size-4" aria-hidden />
        Compartilhar este momento
      </Button>
      <Button asChild variant="outline" size="lg" className="h-12 w-full rounded-xl text-[15px]">
        <Link href="/">
          Acompanhar ao vivo
          <ArrowRight className="size-4" aria-hidden />
        </Link>
      </Button>
      <div className="text-center">
        <SourceStamp at={board.source.at} />
      </div>
    </div>
  );
}
