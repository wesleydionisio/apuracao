// Sua cidade: busca (Command) e página da cidade com parcial, comparações, virada vs 2022 e transferência.
import type { Board, Municipality } from '@apuracao/shared';
import { flipped, fmtPct, twoWay, ufName } from '@apuracao/shared';
import { ChevronRight, Users } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { ShareButton } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { CityCommand, CityPicker } from '@/features/city/CityCommand';
import { loadCityIndex, pushRecent, type RecentCity } from '@/features/city/search';
import { cityHref, pa2022 } from '@/features/map/data';
import { MunMap } from '@/features/map/MunMap';
import { CandidateLines, CompareRow, CountedBar, FlipNote, SectionTitle, StatusBadge, TransferBlock } from '@/features/map/parts';
import { api, HttpError, ogUrl, type CityView } from '@/lib/api';
import { fmtCompact } from '@/lib/format';
import { useBoard } from '@/store/board';

export default function CityPage() {
  const board = useBoard((s) => s.board);
  const params = useParams<{ uf?: string; slug?: string }>();
  const [, nav] = useLocation();
  const go = (m: RecentCity | Municipality) => nav(cityHref(m));
  if (!params.uf || !params.slug) return <CityHome onPick={go} />;
  if (!board) return <DetailSkeleton />;
  return <CityDetail key={`${params.uf}/${params.slug}`} board={board} uf={params.uf} slug={params.slug} onPick={go} />;
}

function CityHome({ onPick }: { onPick: (m: RecentCity | Municipality) => void }) {
  const top = useBoard((s) => s.stats?.topCities);
  return (
    <div className="space-y-5 pb-2 pt-1">
      <header>
        <p className="text-xs text-muted-foreground">Presidente · 2º turno</p>
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Sua cidade</h1>
        <p className="mt-1 text-sm text-muted-foreground">A parcial do seu município comparada com o estado, o Brasil, o 1º turno e 2022.</p>
      </header>
      <section className="overflow-hidden rounded-2xl border bg-card">
        <CityCommand onPick={onPick} placeholder="Digite o nome da cidade" listClassName="max-h-[60dvh] overflow-y-auto" />
      </section>
      {!!top?.length && (
        <section>
          <SectionTitle right={<Users className="size-4 text-muted-foreground" aria-hidden />}>Cidades com mais palpites</SectionTitle>
          <ul className="divide-y rounded-xl border bg-card">
            {top.slice(0, 5).map((c, i) => (
              <li key={c.ibge}>
                <button type="button" onClick={() => loadCityIndex().then((idx) => { const m = idx.find((x) => x.m.ibge === c.ibge)?.m; if (m) onPick(m); })} className="press flex min-h-12 w-full items-center gap-3 px-3 text-left">
                  <span className="num w-4 text-xs text-muted-foreground">{i + 1}</span>
                  <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.uf}</span>
                  <span className="num text-xs text-muted-foreground">{c.n.toLocaleString('pt-BR')}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function CityDetail({ board, uf, slug, onPick }: { board: Board; uf: string; slug: string; onPick: (m: RecentCity | Municipality) => void }) {
  const [view, setView] = useState<CityView | null>(null);
  const [err, setErr] = useState<'404' | 'net' | null>(null);
  const UF = uf.toUpperCase();

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .cityBySlug(UF, slug)
        .then((v) => {
          if (!alive) return;
          setView(v);
          setErr(null);
          pushRecent(v.mun);
        })
        .catch((e) => alive && setErr(e instanceof HttpError && e.status === 404 ? '404' : 'net'));
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [UF, slug]);

  if (err === '404')
    return (
      <div className="space-y-4 pt-1">
        <div className="rounded-2xl border bg-card p-5">
          <h1 className="text-lg font-semibold">Cidade não encontrada</h1>
          <p className="mt-1 text-sm text-muted-foreground">O endereço pode estar incompleto. Busque pelo nome:</p>
        </div>
        <CityPicker onPick={onPick} label="Buscar cidade" />
      </div>
    );
  if (!view)
    return (
      <>
        <DetailSkeleton />
        {err && <p className="mt-3 text-center text-sm text-muted-foreground">Sem conexão. Tentando de novo…</p>}
      </>
    );

  const cands = board.candidates;
  const { mun } = view;
  const live = board.released;
  const now = live ? view.now : null;
  const pa1 = twoWay(view.t1, cands);
  const p22 = pa2022(board, view.y2022);
  const flip = now?.valid && view.y2022 && now.pst >= 5 ? flipped(now, view.y2022, board.y2022Map) : null;
  const shareText = now?.valid
    ? `${mun.name} (${mun.uf}) com ${fmtPct(now.pst, 0)}% apurado: ${cands[0].short} ${fmtPct(now.pa, 1)}% × ${fmtPct(now.pb, 1)}% ${cands[1].short}`
    : `Acompanhe a apuração em ${mun.name} (${mun.uf})`;

  return (
    <div className="space-y-5 pb-2 pt-1">
      <header>
        <div className="flex items-center justify-between gap-2">
          <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground">Brasil</Link>
            <ChevronRight className="size-3 shrink-0" aria-hidden />
            <Link href={`/mapa/${mun.uf}`} className="truncate hover:text-foreground">{ufName(mun.uf)}</Link>
          </nav>
          <CityPicker onPick={onPick} compact />
        </div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[26px] font-semibold leading-tight tracking-tight">{mun.name}</h1>
            <p className="num text-xs text-muted-foreground">
              {mun.uf} · {fmtCompact(mun.el)} eleitores
            </p>
          </div>
          {now && <StatusBadge s={now.status} className="mt-1.5 shrink-0" />}
        </div>
      </header>

      <section className="rounded-2xl border bg-card p-4">
        {now?.valid ? (
          <>
            <CountedBar pst={now.pst} className="mb-4" />
            <CandidateLines cands={cands} snap={now} size="lg" />
          </>
        ) : (
          <PreLive live={live} board={board} pa1={pa1} name={mun.name} />
        )}
      </section>

      {flip && <FlipNote place={mun.name} from={cands.find((c) => c.key === flip.from)!} to={cands.find((c) => c.key === flip.to)!} />}

      <section>
        <SectionTitle>Como {mun.name} se compara</SectionTitle>
        <ul className="divide-y rounded-2xl border bg-card px-4">
          {now?.valid && <CompareRow label={`${mun.name} agora`} hint={`${fmtPct(now.pst, 1)}% apurado`} pa={now.pa} cands={cands} strong />}
          {live && view.uf?.valid ? <CompareRow label={`${ufName(mun.uf)} agora`} hint={`${fmtPct(view.uf.pst, 1)}% apurado`} pa={view.uf.pa} cands={cands} /> : null}
          {live && view.br?.valid ? <CompareRow label="Brasil agora" hint={`${fmtPct(view.br.pst, 1)}% apurado`} pa={view.br.pa} cands={cands} /> : null}
          <CompareRow label={`${mun.name} no 1º turno`} hint="só os votos dos dois finalistas" pa={pa1} cands={cands} />
          <CompareRow label={`${mun.name} em 2022`} hint="2º turno, mesmos partidos" pa={p22} cands={cands} />
        </ul>
      </section>

      {now?.valid && view.t1 && (
        <section className="rounded-2xl border bg-card p-4">
          <SectionTitle>De onde vieram os votos</SectionTitle>
          <TransferBlock snap={now} t1={view.t1} cands={cands} place={`em ${mun.name}`} />
        </section>
      )}

      <section className="rounded-2xl border bg-card p-4">
        <SectionTitle right={<Link href={`/mapa/${mun.uf}`} className="text-xs font-medium text-muted-foreground hover:text-foreground">Mapa de {mun.uf}</Link>}>
          Onde fica
        </SectionTitle>
        <WhenSeen h={200}>
          <MunMap uf={mun.uf} values={{ [mun.ibge]: now?.valid ? now.pa : pa1 }} cands={cands} highlight={mun.ibge} dim maxHeight={220} />
        </WhenSeen>
      </section>

      <ShareButton
        input={{ title: `${mun.name} na apuração`, text: shareText, url: cityHref(mun), image: ogUrl.city(mun.ibge), filename: `${mun.slug}.png` }}
        label="Compartilhar minha cidade"
        className="w-full"
      />
      <SourceStamp at={now?.at ?? board.source.at} />
    </div>
  );
}

function PreLive({ live, board, pa1, name }: { live: boolean; board: Board; pa1: number | null; name: string }) {
  const cands = board.candidates;
  return (
    <div>
      <p className="text-sm text-muted-foreground">
        {live ? `Ainda sem parcial do TSE para ${name}. Atualizamos sozinhos a cada 30 segundos.` : `A parcial de ${name} aparece aqui a partir das 17h de domingo.`}
      </p>
      {pa1 !== null && (
        <div className="mt-4">
          <div className="mb-2 text-xs text-muted-foreground">No 1º turno, entre os dois finalistas</div>
          <div className="flex items-center justify-between gap-3">
            {[
              { c: cands[0], p: pa1 },
              { c: cands[1], p: 100 - pa1 },
            ].map(({ c, p }, i) => (
              <div key={c.key} className={i ? 'flex items-center gap-2 text-right' : 'flex items-center gap-2'}>
                {!i && <CandidateAvatar c={c} size="md" />}
                <div>
                  <div className="text-xs text-muted-foreground">{c.short}</div>
                  <div className="display text-2xl font-semibold">{fmtPct(p, 1)}%</div>
                </div>
                {!!i && <CandidateAvatar c={c} size="md" />}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** só monta os filhos quando entram na tela (a malha municipal é o maior download da página) */
function WhenSeen({ children, h }: { children: ReactNode; h: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setSeen(true), { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return <div ref={ref} style={seen ? undefined : { minHeight: h }}>{seen ? children : null}</div>;
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 pt-1">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-52 w-full rounded-2xl" />
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}
