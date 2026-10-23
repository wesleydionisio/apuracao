// /p/:id — o palpite como card compartilhável + ticker ao vivo (distância e ranking).
import type { Board, CandidateDef } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import { Download, Link2, Share2, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { CandidateAvatar, candOf } from '@/components/core/candidate';
import { LiveDot } from '@/components/core/live';
import { Empty, Skeleton, toast } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, HttpError, ogUrl, type GuessLive, type GuessView as View } from '@/lib/api';
import { fmtInt, fmtPct } from '@/lib/format';
import { downloadImage, prefetchImage, share } from '@/lib/share';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { Pct, SplitBar } from '@/features/standalone/bits';
import { ScoreSide } from './PctSlider';
import { myGuessId } from './Ticket';

const topPct = (rank: number, total: number) => (total ? Math.max(0.01, (rank / total) * 100) : 100);
const fmtTop = (t: number) => fmtPct(t, t < 1 ? 2 : t < 10 ? 1 : 0);
const pts = (d: number) => `ponto${d >= 2 || d === 0 ? 's' : ''}`;

export function useGuess(id: string | undefined) {
  const [v, setV] = useState<View | null>(null);
  const [notFound, setNotFound] = useState(false);
  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () =>
      api
        .guess(id)
        .then((x) => alive && setV(x))
        .catch((e) => alive && e instanceof HttpError && e.status === 404 && setNotFound(true));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);
  return { v, notFound };
}

export default function GuessPageView() {
  const board = useBoard((s) => s.board);
  const { id } = useParams<{ id: string }>();
  const { v, notFound } = useGuess(id);
  if (notFound)
    return (
      <div className="space-y-3 pt-2">
        <Empty title="Palpite não encontrado">O link pode estar incompleto. Confira se copiou o endereço inteiro.</Empty>
        <Button asChild size="lg" className="h-12 w-full rounded-xl">
          <Link href="/palpite">Fazer o meu palpite</Link>
        </Button>
      </div>
    );
  if (!board || !v) return <Skeleton h={420} />;
  return <GuessDetail board={board} v={v} mine={myGuessId() === v.guess.id} />;
}

function GuessDetail({ board, v, mine }: { board: Board; v: View; mine: boolean }) {
  const ca = candOf(board, 'a');
  const cb = candOf(board, 'b');
  if (!ca || !cb) return <Skeleton h={420} />;
  const g = v.guess;
  const live = board.released ? v.live : null;
  const state: 'wait' | 'live' | 'final' = v.final && live ? 'final' : live ? 'live' : 'wait';
  const url = `/p/${g.id}`;
  const top = live ? topPct(live.rank, live.total) : null;
  const shareText =
    state === 'final' && live
      ? `Errei por ${fmtPct(live.dist, 2)} ${pts(live.dist)} o 2º turno${top! <= 50 ? ` — top ${fmtTop(top!)}% do Brasil` : ''}. E você?`
      : `Meu palpite pro 2º turno: ${ca.short} ${fmtPct(g.pa, 1)}% × ${fmtPct(100 - g.pa, 1)}% ${cb.short}. Qual é o seu?`;
  const story = ogUrl.guess(g.id, 'story');

  return (
    <div className="space-y-3 pt-1">
      <section className="overflow-hidden rounded-2xl border bg-card">
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <div className="text-[12px] text-muted-foreground">{mine ? 'Seu palpite' : 'Palpite de'}</div>
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight break-words">{g.nick}</h1>
          </div>
          {state === 'final' ? (
            <Badge variant="secondary" className="gap-1">
              <Trophy className="size-3" aria-hidden />
              Resultado final
            </Badge>
          ) : state === 'live' ? (
            <Badge variant="secondary" className="gap-1.5">
              <LiveDot link="live" />
              Ao vivo
            </Badge>
          ) : (
            <Badge variant="outline">2º turno · 25/out</Badge>
          )}
        </header>

        <div className="px-5 pt-5 pb-5">
          <div className="flex items-end justify-between gap-3">
            <ScoreSide c={ca} v={g.pa} lead={g.pa > 50} dim={g.pa < 50} big />
            <ScoreSide c={cb} v={100 - g.pa} lead={g.pa < 50} dim={g.pa > 50} big right />
          </div>
          <SplitBar
            pa={g.pa}
            ca={ca}
            cb={cb}
            className="mt-4 h-2.5"
            marker={live?.pa ?? null}
            markerLabel={live ? `Parcial agora: ${fmtPct(live.pa, 2)}%` : undefined}
          />
          {live && (
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-1 rounded-full bg-foreground" aria-hidden />
                parcial agora: <Pct v={live.pa} digits={2} className="font-medium text-foreground" />
              </span>
              <span className="num">{fmtPct(board.br?.pst ?? 0, 1)}% apurado</span>
            </div>
          )}
          {(g.uf || g.mun) && (
            <dl className="mt-4 space-y-1.5 text-[13px]">
              {g.uf && g.ufPa != null && <SubRow label={ufName(g.uf)} pa={g.ufPa} />}
              {g.mun && g.munPa != null && <SubRow label="Cidade" pa={g.munPa} />}
            </dl>
          )}
        </div>

        {live && <Ticker live={live} state={state} g={g} />}
      </section>

      <ShareBlock id={g.id} story={story} text={shareText} url={url} final={state === 'final'} />

      {!mine && (
        <Button asChild variant="secondary" size="lg" className="h-12 w-full rounded-xl text-[15px]">
          <Link href="/palpite">Fazer o meu palpite</Link>
        </Button>
      )}
      {state === 'wait' && board.released && <p className="text-center text-[13px] text-muted-foreground">O ranking aparece assim que os primeiros votos forem apurados.</p>}
    </div>
  );
}

function SubRow({ label, pa }: { label: string; pa: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="num font-medium">
        <span className="text-cand-a">{fmtPct(pa, 1)}%</span>
        <span className="mx-1.5 text-muted-foreground">×</span>
        <span className="text-cand-b">{fmtPct(100 - pa, 1)}%</span>
      </dd>
    </div>
  );
}

function Ticker({ live, state, g }: { live: GuessLive; state: 'live' | 'final' | 'wait'; g: View['guess'] }) {
  const ranks: { label: string; rank: number; total: number }[] = [{ label: 'Brasil', rank: live.rank, total: live.total }];
  if (live.ufRank != null && live.ufTotal) ranks.push({ label: g.uf ?? 'Estado', rank: live.ufRank, total: live.ufTotal });
  if (live.munRank != null && live.munTotal) ranks.push({ label: 'Cidade', rank: live.munRank, total: live.munTotal });
  return (
    <div className="border-t bg-muted/40 px-5 py-4">
      <div className="text-[12px] text-muted-foreground">{state === 'final' ? 'Resultado do palpite' : 'Distância para o parcial'}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        {state === 'final' && live.dist < 0.05 ? (
          <span className="display text-[32px] leading-tight font-semibold">Na mosca</span>
        ) : (
          <>
            {state === 'final' && <span className="text-[17px] font-medium">errou por</span>}
            <Pct v={live.dist} digits={2} suffix="" className="display text-[32px] leading-tight font-semibold" />
            <span className="text-[15px] text-muted-foreground">{pts(live.dist)}</span>
          </>
        )}
      </div>
      <div className={cn('mt-3 grid gap-2', ranks.length === 1 ? 'grid-cols-1' : ranks.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {ranks.map((r) => {
          const t = topPct(r.rank, r.total);
          return (
            <div key={r.label} className="rounded-xl border bg-card px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground">{r.label}</div>
              <div className="num mt-0.5 text-[17px] leading-tight font-semibold">
                {fmtInt(r.rank)}º<span className="text-[12px] font-normal text-muted-foreground"> de {fmtInt(r.total)}</span>
              </div>
              <div className={cn('num text-[11px]', t <= 10 ? 'font-medium text-live' : 'text-muted-foreground')}>top {fmtTop(t)}%</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShareBlock({ id, story, text, url, final }: { id: string; story: string; text: string; url: string; final: boolean }) {
  const [busy, setBusy] = useState(false);
  const [noPreview, setNoPreview] = useState(false);
  const preview = ogUrl.guess(id, 'og');
  return (
    <section className="rounded-2xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">{final ? 'Mostre seu resultado' : 'Mande no grupo'}</h2>
        {!noPreview && <span className="text-[11px] text-muted-foreground">prévia do card</span>}
      </div>
      {!noPreview && (
      <img
        onError={() => setNoPreview(true)}
        src={preview}
        alt="Prévia da imagem que será compartilhada"
        width={1200}
        height={630}
        loading="lazy"
        decoding="async"
        className="mt-3 aspect-[1200/630] w-full rounded-xl border bg-muted object-cover"
      />
      )}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="col-span-2 h-12 rounded-xl text-[15px]"
          disabled={busy}
          onPointerDown={() => prefetchImage(story)}
          onClick={async () => {
            setBusy(true);
            const r = await share({ title: 'Meu palpite', text, url, image: story, filename: 'palpite.png' });
            setBusy(false);
            if (r === 'copied') toast('Link copiado — cole no WhatsApp');
            else if (r === 'failed') toast('Não deu para compartilhar daqui');
          }}
        >
          <Share2 className="size-4" aria-hidden />
          {final ? 'Compartilhar resultado' : 'Compartilhar no WhatsApp'}
        </Button>
        <Button variant="outline" className="h-11 rounded-xl" onClick={() => downloadImage(story, 'palpite.png')}>
          <Download className="size-4" aria-hidden />
          Imagem p/ Stories
        </Button>
        <Button
          variant="outline"
          className="h-11 rounded-xl"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(new URL(url, location.origin).toString());
              toast('Link copiado');
            } catch {
              toast('Não deu para copiar');
            }
          }}
        >
          <Link2 className="size-4" aria-hidden />
          Copiar link
        </Button>
      </div>
    </section>
  );
}
