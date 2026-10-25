// /p/:id — o palpite como card compartilhável + ticker ao vivo (distância e ranking).
import type { Board, CandidateDef } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import { ChartColumn, Download, Link2, Loader2, Medal, Share2, Trophy } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useParams } from 'wouter';
import { CandidateAvatar, candOf } from '@/components/core/candidate';
import { DataTip } from '@/components/core/datatip';
import { LiveDot } from '@/components/core/live';
import { Empty, Skeleton, toast } from '@/components/ui';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, HttpError, ogUrl, type GuessLive, type GuessView as View } from '@/lib/api';
import { fmtInt, fmtPct } from '@/lib/format';
import { poll } from '@/lib/poll';
import { downloadImage, imageReady, loadImage, prefetchImage, share } from '@/lib/share';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { Pct, SplitBar } from './bits';
import { GuessHistogram, useGuessHist } from './Histogram';
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
    let got = false;
    const load = () =>
      api
        .guess(id)
        .then((x) => {
          got = true;
          if (alive) setV(x);
        })
        .catch((e) => {
          if (alive && e instanceof HttpError && e.status === 404) setNotFound(true);
          // ainda sem nada na tela: tenta de novo logo; com dado, segue no ritmo normal
          else if (!got) throw e;
        });
    // cada id é único (a CDN quase não ajuda): 45–60 s, ×3 com a aba oculta, na hora ao voltar para ela
    const stop = poll(load, 45_000, { jitter: 0.33, retry: 10_000 });
    return () => {
      alive = false;
      stop();
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
  const hist = useGuessHist();
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
      ? `Errei por ${fmtPct(live.dist, 2)} ${pts(live.dist)} o 2º turno${top! <= 50 ? `, top ${fmtTop(top!)}% do Brasil` : ''}. E você?`
      : `Meu palpite pro 2º turno: ${ca.short} ${fmtPct(g.pa, 1)}% × ${fmtPct(100 - g.pa, 1)}% ${cb.short}. Qual é o seu?`;
  const image = (f: Poster) => ogUrl.guess(g.id, f, g.updatedAt);

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

        {live && <Ticker live={live} state={state} g={g} pst={board.br?.pst ?? 0} />}
      </section>

      <ShareBlock
        image={image}
        text={shareText}
        url={url}
        final={state === 'final'}
        preview={(f) => (
          <CardPreview
            fmt={f}
            nick={g.nick}
            pa={g.pa}
            ca={ca}
            cb={cb}
            result={state === 'final' && live ? { pa: live.pa, dist: live.dist, top: top! } : null}
          />
        )}
      />

      {hist && hist.total > 0 && (
        <section className="rounded-2xl border bg-card p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-1.5 text-[15px] font-semibold">
              <ChartColumn className="size-4 text-muted-foreground" aria-hidden />
              Onde estão os palpites
            </h2>
            <span className="flex shrink-0 items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <span className="h-3 w-0.5 rounded-full bg-foreground" aria-hidden />
                palpite
              </span>
              {live && (
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-0 border-l-[1.5px] border-dashed border-foreground" aria-hidden />
                  parcial
                </span>
              )}
            </span>
          </div>
          <GuessHistogram hist={hist} ca={ca} cb={cb} mine={g.pa} live={live?.pa ?? null} />
        </section>
      )}

      {!mine ? (
        <Button asChild variant="secondary" size="lg" className="h-12 w-full rounded-xl text-[15px]">
          <Link href="/palpite">Fazer o meu palpite</Link>
        </Button>
      ) : (
        !board.released && (
          // um palpite por aparelho: o que dá para fazer é ajustar este
          <Button asChild variant="secondary" size="lg" className="h-12 w-full rounded-xl text-[15px]">
            <Link href="/palpite">Ajustar meu palpite</Link>
          </Button>
        )
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

/** trilha da distância ao longo da noite, guardada no aparelho (a API só dá o valor atual) */
type TrailPoint = { pst: number; dist: number };
function useDistanceTrail(id: string, pst: number, dist: number | null): TrailPoint[] {
  const key = `guess-trail:${id}`;
  const [trail, setTrail] = useState<TrailPoint[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(key) ?? '[]') as TrailPoint[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    if (dist === null || !(pst > 0)) return;
    setTrail((cur) => {
      const last = cur[cur.length - 1];
      if (last && pst <= last.pst) return cur; // só anda para frente
      const next = [...cur, { pst: Math.round(pst * 100) / 100, dist: Math.round(dist * 100) / 100 }].slice(-240);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* sem storage */
      }
      return next;
    });
  }, [key, pst, dist]);
  return trail;
}

function DistanceSpark({ trail, className }: { trail: TrailPoint[]; className?: string }) {
  if (trail.length < 2) return null;
  const W = 120;
  const H = 36;
  const max = Math.max(...trail.map((p) => p.dist), 0.5);
  // eixo x = trecho da noite já visto (do primeiro ao último ponto), para a linha ocupar a largura toda
  const x0 = trail[0].pst;
  const x1 = Math.max(trail[trail.length - 1].pst, x0 + 1);
  const x = (pst: number) => ((pst - x0) / (x1 - x0)) * W;
  const y = (d: number) => 2 + (d / max) * (H - 4);
  const d = trail.map((p, i) => `${i ? 'L' : 'M'}${x(p.pst).toFixed(1)},${y(p.dist).toFixed(1)}`).join(' ');
  const best = trail.reduce((a, b) => (b.dist < a.dist ? b : a));
  const last = trail[trail.length - 1];
  const summary = `Menor distância da noite: ${fmtPct(best.dist, 2)} pontos com ${fmtPct(best.pst, 0)}% apurado. Agora: ${fmtPct(last.dist, 2)} pontos`;
  return (
    <DataTip
      className="inline-block"
      label={summary}
      tip={
        <div className="num space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-live" />
            Melhor: {fmtPct(best.dist, 2)} pts com {fmtPct(best.pst, 0)}% apurado
          </div>
          <div className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-foreground" />
            Agora: {fmtPct(last.dist, 2)} pts
          </div>
          <div className="text-[11px] text-muted-foreground">quanto mais alto, mais perto do parcial</div>
        </div>
      }
    >
    <svg viewBox={`0 0 ${W} ${H}`} className={cn('h-9 w-[120px] overflow-visible', className)} aria-hidden>
      {/* em cima = perto do parcial */}
      <line x1={0} x2={W} y1={2} y2={2} stroke="var(--foreground)" strokeOpacity={0.15} />
      <path d={d} fill="none" stroke="var(--foreground)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(best.pst)} cy={y(best.dist)} r={2.5} fill="var(--live)" />
      <circle cx={x(last.pst)} cy={y(last.dist)} r={2.5} fill="var(--foreground)" />
    </svg>
    </DataTip>
  );
}

/** medalha sóbria: só ganha cor de metal quando a posição merece (pódio ou topo percentual) */
function medalTone(rank: number, top: number) {
  if (rank === 1 || top <= 1) return '#c9a227';
  if (rank === 2 || top <= 5) return '#9aa4b1';
  if (rank === 3 || top <= 10) return '#b07a4a';
  return null;
}

function Ticker({ live, state, g, pst }: { live: GuessLive; state: 'live' | 'final' | 'wait'; g: View['guess']; pst: number }) {
  const trail = useDistanceTrail(g.id, pst, state === 'final' ? null : live.dist);
  const best = trail.length ? trail.reduce((a, b) => (b.dist < a.dist ? b : a)) : null;
  const ranks: { label: string; rank: number; total: number }[] = [{ label: 'Brasil', rank: live.rank, total: live.total }];
  if (live.ufRank != null && live.ufTotal) ranks.push({ label: g.uf ?? 'Estado', rank: live.ufRank, total: live.ufTotal });
  if (live.munRank != null && live.munTotal) ranks.push({ label: 'Cidade', rank: live.munRank, total: live.munTotal });
  return (
    <div className="border-t bg-muted/40 px-5 py-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
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
        </div>
        {state !== 'final' && trail.length >= 2 && (
          <div className="shrink-0 text-right">
            <DistanceSpark trail={trail} />
            {best && (
              <div className="num mt-1 text-[11px] text-muted-foreground">
                <span className="mr-1 inline-block size-1.5 rounded-full bg-live align-middle" aria-hidden />
                mais perto: {fmtPct(best.dist, 2)} com {fmtPct(best.pst, 0)}%
              </div>
            )}
          </div>
        )}
      </div>
      <ul className={cn('mt-4 grid gap-2', ranks.length === 1 ? 'grid-cols-1' : ranks.length === 2 ? 'grid-cols-2' : 'grid-cols-3')}>
        {ranks.map((r) => {
          const t = topPct(r.rank, r.total);
          const tone = medalTone(r.rank, t);
          return (
            <li key={r.label} className="flex flex-col rounded-xl border bg-card px-3 py-2.5">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-[11px] text-muted-foreground">{r.label}</span>
                <Medal className="size-4 shrink-0" style={{ color: tone ?? 'var(--muted-foreground)', opacity: tone ? 1 : 0.4 }} aria-hidden />
              </div>
              <div className="num mt-1 text-[19px] leading-none font-semibold tracking-tight">
                {fmtInt(r.rank)}º
              </div>
              <div className="num mt-1 truncate text-[11px] text-muted-foreground">de {fmtInt(r.total)}</div>
              <div className={cn('num truncate text-[11px]', tone ? 'font-medium text-foreground' : 'text-muted-foreground')}>top {fmtTop(t)}%</div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Poster = 'story' | 'portrait' | 'wide';
const POSTERS: { f: Poster; label: string; ratio: string; size: string }[] = [
  { f: 'story', label: 'Stories', ratio: '9:16', size: '1080×1920' },
  { f: 'portrait', label: 'Feed', ratio: '3:4', size: '1080×1440' },
  { f: 'wide', label: 'Horizontal', ratio: '16:9', size: '1920×1080' },
];
const FMT_KEY = 'guess-share-fmt';
function savedFmt(): Poster {
  try {
    const v = localStorage.getItem(FMT_KEY);
    return POSTERS.some((p) => p.f === v) ? (v as Poster) : 'story';
  } catch {
    return 'story';
  }
}

/** tamanho de desenho da prévia (px); a caixa real escala por cima, então o conteúdo cabe igual em qualquer largura */
const DESIGN: Record<Poster, [number, number]> = { story: [216, 384], portrait: [216, 288], wide: [384, 216] };

/**
 * Prévia do pôster desenhada aqui mesmo, no formato escolhido: o PNG só é pedido à API quando a pessoa toca em
 * compartilhar ou baixar (e quando o WhatsApp busca a prévia do link). Mesma ordem do pôster: a aposta, o duelo, o desafio.
 */
function CardPreview({
  fmt,
  nick,
  pa,
  ca,
  cb,
  result,
}: {
  fmt: Poster;
  nick: string;
  pa: number;
  ca: CandidateDef;
  cb: CandidateDef;
  result: { pa: number; dist: number; top: number } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [W, H] = DESIGN[fmt];
  const [k, setK] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [W]);

  const pb = 100 - pa;
  const win = pa > 50 ? ca : pb > 50 ? cb : null;
  const wide = fmt === 'wide';
  const side = (c: CandidateDef, v: number) => (
    <div className={cn('flex min-w-0 flex-1 flex-col items-center gap-1', v < 50 && 'opacity-60')}>
      <CandidateAvatar c={c} size="md" ring={v > 50} />
      <span className="max-w-full truncate text-[10px] font-semibold">{c.short}</span>
      <span className="num text-[21px] leading-none font-extrabold tracking-tight">{fmtPct(v, 1)}%</span>
    </div>
  );
  const head = result ? (
    <div className="min-w-0">
      <div className="text-[19px] leading-[1.05] font-extrabold tracking-tight">
        {result.dist < 0.005 ? 'Na mosca!' : `Errei por ${fmtPct(result.dist, 2)} ponto${result.dist >= 2 ? 's' : ''}`}
      </div>
      {result.top <= 50 && (
        <span className="mt-1.5 inline-block rounded bg-[#facc15] px-1.5 py-px text-[11px] font-extrabold text-black">top {fmtTop(result.top)}% do Brasil</span>
      )}
    </div>
  ) : (
    <div className="min-w-0 text-[20px] leading-[1.05] font-extrabold tracking-tight">
      {win ? (
        <>
          <div className="truncate">{win.short}</div>
          <div>
            <span className="text-muted-foreground">vence com </span>
            <span style={{ color: win.color }}>{fmtPct(Math.max(pa, pb), 1)}%</span>
          </div>
        </>
      ) : (
        'Empate: 50 × 50'
      )}
    </div>
  );
  const duel = (
    <div className={cn('rounded-xl border bg-card/90 px-2 py-2.5', wide && 'w-[46%] shrink-0')}>
      <div className="flex gap-1">
        {side(ca, pa)}
        {side(cb, pb)}
      </div>
      <div className="mt-2 flex h-1.5 gap-px overflow-hidden rounded-full" aria-hidden>
        <div style={{ flexBasis: `${pa}%`, background: ca.color }} />
        <div className="flex-1" style={{ background: cb.color }} />
      </div>
      {result && <div className="num mt-1.5 truncate text-center text-[9px] text-muted-foreground">TSE: {fmtPct(result.pa, 2)}% × {fmtPct(100 - result.pa, 2)}%</div>}
    </div>
  );
  const dare = (
    <div className="min-w-0">
      <div className="text-[12.5px] leading-tight font-extrabold">{result ? 'E você, quanto errou?' : 'Duvido você chegar mais perto.'}</div>
      <div className="mt-1.5 truncate rounded-full bg-foreground px-2 py-1 text-center text-[9.5px] font-bold text-background">
        {result ? 'Veja o seu em' : 'Faça o seu em'} <span style={{ color: win?.color }}>{location.host}</span>
      </div>
    </div>
  );
  return (
    <div
      ref={box}
      role="img"
      aria-label={`Prévia do card: ${ca.short} ${fmtPct(pa, 1)}% × ${fmtPct(pb, 1)}% ${cb.short}`}
      className={cn(
        'relative shrink-0 overflow-hidden rounded-xl border bg-background shadow-[var(--shadow-card)] select-none',
        fmt === 'story' && 'aspect-[9/16] w-[40%] max-w-44',
        fmt === 'portrait' && 'aspect-[3/4] w-[44%] max-w-52',
        wide && 'aspect-video w-full max-w-md',
      )}
      style={{ backgroundImage: `linear-gradient(90deg, ${ca.color}33, transparent 45%, transparent 55%, ${cb.color}33)` }}
    >
      <div
        className="absolute top-0 left-0 flex origin-top-left flex-col p-3.5"
        style={{ width: W, height: H, transform: `scale(${k})`, visibility: k ? undefined : 'hidden' }}
      >
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="whitespace-nowrap">
            <b className="font-extrabold text-foreground">urna.digi</b> · 2º turno
          </span>
          <span className="truncate">{nick}</span>
        </div>
        {wide ? (
          <div className="flex min-h-0 flex-1 items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              {head}
              {dare}
            </div>
            {duel}
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col justify-around gap-2 pt-2">
            {head}
            {duel}
            {dare}
          </div>
        )}
      </div>
    </div>
  );
}

function ShareBlock({
  image,
  text,
  url,
  final,
  preview,
}: {
  image: (f: Poster) => string;
  text: string;
  url: string;
  final: boolean;
  preview: (f: Poster) => React.ReactNode;
}) {
  const [busy, setBusy] = useState<'gen' | 'share' | 'dl' | null>(null);
  const [fmt, setFmtState] = useState<Poster>(savedFmt);
  const setFmt = (f: Poster) => {
    setFmtState(f);
    try {
      localStorage.setItem(FMT_KEY, f);
    } catch {
      /* sem armazenamento: vale só nesta visita */
    }
  };
  const src = image(fmt);
  const cur = POSTERS.find((p) => p.f === fmt)!;
  const filename = `palpite-${cur.ratio.replace(':', 'x')}.png`;
  // sem Web Share (desktop) o share só copia o link: nem pede o PNG
  const canShare = typeof navigator.share === 'function';
  const copy = (
    <>
      <h2 className="text-[17px] leading-tight font-semibold text-balance">{final ? 'Mostre seu resultado' : 'Mande no grupo'}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground text-pretty">
        {final ? 'O card mostra quanto você errou e sua posição.' : 'O card desafia quem receber a chegar mais perto.'}
      </p>
    </>
  );
  return (
    <section className="rounded-2xl border bg-card p-4">
      <div role="radiogroup" aria-label="Formato da imagem" className="mb-4 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1">
        {POSTERS.map((p) => (
          <button
            key={p.f}
            type="button"
            role="radio"
            aria-checked={fmt === p.f}
            onClick={() => setFmt(p.f)}
            className={cn(
              'press flex h-11 flex-col items-center justify-center rounded-lg text-[13px] leading-tight font-semibold transition-colors',
              fmt === p.f ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {p.label}
            <span className="num text-[10.5px] font-medium text-muted-foreground">{p.ratio}</span>
          </button>
        ))}
      </div>
      {fmt === 'wide' ? (
        <div>
          {preview(fmt)}
          <div className="mt-3">{copy}</div>
        </div>
      ) : (
        <div className="flex gap-4">
          {preview(fmt)}
          <div className="flex min-w-0 flex-1 flex-col">
            {copy}
            <div className="mt-auto hidden pt-3 text-[11px] text-muted-foreground sm:block">
              {cur.label} ({cur.size}). O link mostra a prévia no WhatsApp.
            </div>
          </div>
        </div>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          size="lg"
          className="col-span-2 h-12 rounded-xl text-[15px]"
          disabled={!!busy}
          onPointerDown={() => canShare && prefetchImage(src)}
          onClick={async () => {
            // o card só é gerado agora; se demorar, o gesto pode expirar antes do share
            const waited = canShare && !imageReady(src);
            setBusy(waited ? 'gen' : 'share');
            if (waited) await loadImage(src);
            setBusy('share');
            const r = await share({ title: 'Meu palpite', text, url, image: src, filename });
            setBusy(null);
            if (r === 'copied') toast('Link copiado. Cole no WhatsApp');
            else if (r === 'failed') toast(waited && imageReady(src) ? 'Imagem pronta: toque de novo para compartilhar' : 'Não deu para compartilhar daqui');
          }}
        >
          {busy === 'gen' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Share2 className="size-4" aria-hidden />}
          {busy === 'gen' ? 'Gerando imagem…' : final ? 'Compartilhar resultado' : 'Compartilhar no WhatsApp'}
        </Button>
        <Button
          variant="outline"
          className="h-11 rounded-xl"
          disabled={!!busy}
          onClick={async () => {
            setBusy('dl');
            await downloadImage(src, filename);
            setBusy(null);
          }}
        >
          {busy === 'dl' ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          Baixar imagem
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
