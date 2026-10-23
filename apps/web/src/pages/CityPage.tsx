// Sua cidade: busca (Command) e a "ficha" da cidade — parcial, referências, comparação, virada vs 2022,
// transferência, onde fica e cidades parecidas.
import type { Board, CandidateDef, Municipality, Snap } from '@apuracao/shared';
import { flipped, fmtPct, twoWay, ufName } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { ArrowRightLeft, ChevronRight, MapPin, Scale, Shuffle, Users } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { ShareButton } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { CityCommand, CityPicker } from '@/features/city/CityCommand';
import { loadCityIndex, pushRecent, type RecentCity } from '@/features/city/search';
import { leaderOf, marginPts } from '@/features/map/colors';
import { cityHref, pa2022, useUfMunicipalities, type MunRow } from '@/features/map/data';
import HexMap from '@/features/map/HexMap';
import {
  CompareRow,
  CountedBar,
  FlipNote,
  ofUf,
  RefLegend,
  SectionTitle,
  StatusBadge,
  TransferBlock,
  VersusBar,
  WhenSeen,
  type RefMark,
} from '@/features/map/parts';
import { api, HttpError, ogUrl, type CityView } from '@/lib/api';
import { fmtCompact, fmtInt } from '@/lib/format';
import { cn } from '@/lib/utils';
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
        <p className="text-xs text-muted-foreground">Presidente, 2º turno, por município</p>
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">Sua cidade</h1>
        <p className="mt-1 text-sm text-muted-foreground text-pretty">A parcial do seu município comparada com o estado, o Brasil, o 1º turno e 2022.</p>
      </header>
      <section className="overflow-hidden rounded-2xl border bg-card">
        <CityCommand onPick={onPick} placeholder="Digite o nome da cidade" listClassName="max-h-[60dvh] overflow-y-auto" />
      </section>
      {!!top?.length && (
        <section>
          <SectionTitle icon={Users} meta="palpites">
            Cidades mais engajadas
          </SectionTitle>
          <ol className="divide-y rounded-xl border bg-card">
            {top.slice(0, 5).map((c, i) => (
              <li key={c.ibge}>
                <button
                  type="button"
                  onClick={() =>
                    loadCityIndex().then((idx) => {
                      const m = idx.find((x) => x.m.ibge === c.ibge)?.m;
                      if (m) onPick(m);
                    })
                  }
                  className="press flex min-h-12 w-full items-center gap-3 px-3 text-left"
                >
                  <span className="num w-4 text-xs text-muted-foreground">{i + 1}</span>
                  <span className="flex-1 truncate text-sm font-medium">{c.name}</span>
                  <span className="text-xs text-muted-foreground">{c.uf}</span>
                  <span className="num w-12 text-right text-xs font-medium">{c.n.toLocaleString('pt-BR')}</span>
                </button>
              </li>
            ))}
          </ol>
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

  return <CitySheet board={board} view={view} onPick={onPick} />;
}

function CitySheet({ board, view, onPick }: { board: Board; view: CityView; onPick: (m: RecentCity | Municipality) => void }) {
  const cands = board.candidates;
  const { mun } = view;
  const live = board.released;
  const now = live && view.now?.valid ? view.now : null;
  const ufSnap = live && view.uf?.valid ? view.uf : null;
  const brSnap = live && view.br?.valid ? view.br : null;
  const pa1 = twoWay(view.t1, cands);
  const p22 = pa2022(board, view.y2022);
  const flip = now && view.y2022 && now.pst >= 5 ? flipped(now, view.y2022, board.y2022Map) : null;
  // cidade e estado com o mesmo nome (São Paulo, Rio de Janeiro): o estado ganha "Estado de …"
  const ufLabel = mun.name === ufName(mun.uf) ? `Estado ${ofUf(mun.uf)}` : ufName(mun.uf);
  const refs: RefMark[] = [
    ...(pa1 != null ? [{ pa: pa1, tag: 't1', label: '1º turno' }] : []),
    ...(p22 != null ? [{ pa: p22, tag: 'y22', label: '2022' }] : []),
  ];
  const shareText = now
    ? `${mun.name} (${mun.uf}) com ${fmtPct(now.pst, 0)}% apurado: ${cands[0].short} ${fmtPct(now.pa, 1)}% × ${fmtPct(now.pb, 1)}% ${cands[1].short}`
    : `Acompanhe a apuração em ${mun.name} (${mun.uf})`;
  const base = now?.pa ?? null;
  const d = (ref: number | null) => (base === null ? undefined : ref === null ? null : base - ref);

  return (
    <div className="space-y-4 pb-2 pt-1">
      <header>
        <div className="flex items-center justify-between gap-2">
          <nav aria-label="Você está em" className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Link href="/mapa" className="hover:text-foreground">
              Brasil
            </Link>
            <ChevronRight className="size-3 shrink-0" aria-hidden />
            <Link href={`/mapa/${mun.uf}`} className="truncate hover:text-foreground">
              {ufName(mun.uf)}
            </Link>
          </nav>
          <CityPicker onPick={onPick} compact />
        </div>
        <div className="mt-1 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[28px] font-semibold leading-tight tracking-tight text-balance">{mun.name}</h1>
            <p className="num mt-0.5 text-xs text-muted-foreground">
              {mun.uf} · {fmtCompact(mun.el)} eleitores
            </p>
            {view.t1?.el && view.t1.turnout ? (
              <p className="num text-xs text-muted-foreground">{fmtPct((view.t1.turnout / view.t1.el) * 100, 0)}% compareceram no 1º turno</p>
            ) : null}
          </div>
          {now && <StatusBadge s={now.status} className="mt-2 shrink-0" />}
        </div>
      </header>

      <section className="rounded-2xl border bg-card p-4">
        {now ? (
          <>
            <CountedBar pst={now.pst} className="mb-4" />
            <Versus cands={cands} pa={now.pa} votes={[now.a, now.b]} lead={now.lead} />
          </>
        ) : (
          <PreLive live={live} name={mun.name} pa1={pa1} cands={cands} />
        )}
        {(now || pa1 != null) && (
          <div className="mt-4">
            <VersusBar pa={now?.pa ?? pa1!} cands={cands} h="h-2.5" refs={now ? refs : refs.filter((r) => r.tag !== 't1')} />
            <RefLegend className="mt-2.5" cands={cands} refs={now ? refs : refs.filter((r) => r.tag !== 't1')} />
          </div>
        )}
        {now && <Headline cands={cands} name={mun.name} now={now} uf={ufSnap} pa1={pa1} p22={p22} />}
      </section>

      {flip && <FlipNote place={mun.name} from={cands.find((c) => c.key === flip.from)!} to={cands.find((c) => c.key === flip.to)!} />}

      <section className="rounded-2xl border bg-card px-4 pt-4 pb-1">
        <SectionTitle icon={Scale}>Como {mun.name} se compara</SectionTitle>
        <ul className="-mt-1 divide-y">
          {now && <CompareRow label={`${mun.name} agora`} hint={`${fmtPct(now.pst, 1)}% apurado`} pa={now.pa} cands={cands} strong delta={0} />}
          {ufSnap && <CompareRow label={ufLabel} hint={`agora · ${fmtPct(ufSnap.pst, 1)}% apurado`} pa={ufSnap.pa} cands={cands} delta={d(ufSnap.pa)} />}
          {brSnap && <CompareRow label="Brasil" hint={`agora · ${fmtPct(brSnap.pst, 1)}% apurado`} pa={brSnap.pa} cands={cands} delta={d(brSnap.pa)} />}
          <CompareRow label={`${mun.name} no 1º turno`} hint="só os votos dos dois finalistas" pa={pa1} cands={cands} delta={d(pa1)} />
          <CompareRow label={`${mun.name} em 2022`} hint="2º turno, mesmos partidos" pa={p22} cands={cands} delta={d(p22)} />
        </ul>
        {base !== null && <p className="pb-3 text-[12px] text-muted-foreground">À direita: quantos pontos {mun.name} está mais perto de cada um do que a referência.</p>}
      </section>

      {now && view.t1 && (
        <section className="rounded-2xl border bg-card p-4">
          <SectionTitle icon={ArrowRightLeft}>De onde vieram os votos</SectionTitle>
          <TransferBlock snap={now} t1={view.t1} cands={cands} place={`em ${mun.name}`} />
        </section>
      )}

      <section className="rounded-2xl border bg-card p-4">
        <SectionTitle
          icon={MapPin}
          right={
            <Link href={`/mapa/${mun.uf}`} className="inline-flex min-h-9 items-center text-xs font-medium text-muted-foreground hover:text-foreground">
              Mapa {ofUf(mun.uf)}
            </Link>
          }
        >
          Onde fica
        </SectionTitle>
        <WhenSeen h={220}>
          <HexMap
            cands={cands}
            layer={now ? 'live' : 't1'}
            scope={mun.uf}
            highlight={mun.ibge}
            dimOthers
            maxHeight={260}
            label={`Mapa ${ofUf(mun.uf)} em hexágonos, com ${mun.name} contornada`}
          />
        </WhenSeen>
        <p className="mt-2 text-center text-[12px] text-muted-foreground">
          {mun.name} contornada no mapa {ofUf(mun.uf)}; cada região na cor de quem lidera {now ? 'agora' : 'no 1º turno'}.
        </p>
      </section>

      <SimilarCities board={board} mun={mun} />

      <ShareButton
        input={{ title: `${mun.name} na apuração`, text: shareText, url: cityHref(mun), image: ogUrl.city(mun.ibge), filename: `${mun.slug}.png` }}
        label="Compartilhar minha cidade"
        className="w-full"
      />
      <SourceStamp at={view.now?.at ?? board.source.at} />
    </div>
  );
}

/** dois lados lado a lado: foto, nome, % grande e votos (o placar da cidade) */
function Versus({ cands, pa, votes, lead, label }: { cands: CandidateDef[]; pa: number; votes?: [number, number]; lead: 'a' | 'b' | null; label?: string }) {
  const sides = [
    { c: cands[0], p: pa, v: votes?.[0], on: lead === 'a' },
    { c: cands[1], p: 100 - pa, v: votes?.[1], on: lead === 'b' },
  ];
  return (
    <div>
      {label && <div className="mb-2 text-xs text-muted-foreground">{label}</div>}
      <div className="grid grid-cols-2 gap-3">
        {sides.map(({ c, p, v, on }, i) => (
          <div key={c.key} className={cn('flex min-w-0 flex-col gap-2', i && 'items-end text-right')}>
            <div className={cn('flex min-w-0 items-center gap-2.5', i && 'flex-row-reverse')}>
              <CandidateAvatar c={c} size="lg" ring={on} />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold leading-tight">{c.short}</div>
                {c.party && <div className="text-[11px] text-muted-foreground">{c.party}</div>}
              </div>
            </div>
            <div className={cn('display text-[34px] font-semibold leading-none', !on && lead && 'text-muted-foreground')}>
              <NumberFlow value={p} locales="pt-BR" format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} suffix="%" />
            </div>
            {v !== undefined && <div className="num text-[11px] text-muted-foreground">{fmtInt(v)} votos</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

/** manchete automática: como a cidade se desloca em relação ao estado e a 2022 */
function Headline({
  cands,
  name,
  now,
  uf,
  pa1,
  p22,
}: {
  cands: CandidateDef[];
  name: string;
  now: Snap;
  uf: Snap | null;
  pa1: number | null;
  p22: number | null;
}) {
  const bits: { ref: string; d: number }[] = [];
  if (uf) bits.push({ ref: 'o estado', d: now.pa - uf.pa });
  if (p22 != null) bits.push({ ref: 'em 2022', d: now.pa - p22 });
  else if (pa1 != null) bits.push({ ref: 'no 1º turno', d: now.pa - pa1 });
  const shown = bits.filter((b) => Math.abs(b.d) >= 0.5);
  if (!shown.length) return null;
  const phrase = (b: { ref: string; d: number }) => {
    const c = b.d > 0 ? cands[0] : cands[1];
    return (
      <>
        <span className="num font-semibold" style={{ color: c.color }}>
          {fmtPct(Math.abs(b.d), 1)} pts mais {c.short}
        </span>{' '}
        que {b.ref}
      </>
    );
  };
  return (
    <p className="mt-4 border-t pt-3 text-[13px] leading-snug text-muted-foreground text-pretty">
      Até aqui, {name} está {phrase(shown[0])}
      {shown[1] && <> e {phrase(shown[1])}</>}.
    </p>
  );
}

function PreLive({ live, name, pa1, cands }: { live: boolean; name: string; pa1: number | null; cands: CandidateDef[] }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground text-pretty">
        {live ? `Ainda sem parcial do TSE para ${name}. Atualizamos sozinhos a cada 30 segundos.` : `A parcial de ${name} aparece aqui a partir das 17h de domingo.`}
      </p>
      {pa1 !== null && (
        <div className="mt-4">
          <Versus cands={cands} pa={pa1} lead={pa1 > 50 ? 'a' : pa1 < 50 ? 'b' : null} label="No 1º turno, entre os dois finalistas" />
        </div>
      )}
    </div>
  );
}

/** Cidades da mesma UF com eleitorado parecido — atalhos para comparar vizinhas de porte */
function SimilarCities({ board, mun }: { board: Board; mun: Municipality }) {
  const live = !!board.released && board.flags.map_mun;
  const { data } = useUfMunicipalities(mun.uf, live);
  const cands = board.candidates;
  const picks = useMemo(() => {
    const rows = (data?.rows ?? []).filter((r) => r.m.ibge !== mun.ibge && r.m.el > 0);
    const lg = Math.log(Math.max(1, mun.el));
    return rows
      .map((r) => ({ r, k: Math.abs(Math.log(r.m.el) - lg) }))
      .sort((a, b) => a.k - b.k)
      .slice(0, 6)
      .map((x) => x.r)
      .sort((a, b) => b.m.el - a.m.el);
  }, [data, mun.ibge, mun.el]);
  if (!picks.length) return null;
  const valueOf = (r: MunRow) => (r.s?.valid ? r.s.pa : twoWay(r.t1, cands));
  const anyLive = picks.some((r) => r.s?.valid);
  return (
    <section className="rounded-2xl border bg-card p-4">
      <SectionTitle icon={Shuffle} meta={`${mun.uf} · ${anyLive ? 'agora' : '1º turno'}`}>
        Cidades parecidas
      </SectionTitle>
      <ul className="grid grid-cols-2 gap-2">
        {picks.map((r) => {
          const pa = valueOf(r);
          const lead = pa != null ? leaderOf(pa, cands) : null;
          return (
            <li key={r.m.ibge}>
              <Link href={cityHref(r.m)} className="press flex min-h-16 flex-col justify-between rounded-xl border bg-background/40 p-2.5 hover:bg-accent/50">
                <span className="truncate text-[13px] font-medium">{r.m.name}</span>
                <span className="mt-1 flex items-center justify-between gap-2">
                  <span className="num text-[11px] text-muted-foreground">{fmtCompact(r.m.el)}</span>
                  {lead && pa != null ? (
                    <span className="flex items-center gap-1">
                      <CandidateAvatar c={lead} size="xs" />
                      <span className="num text-[12px] font-semibold" style={{ color: lead.color }}>
                        +{fmtPct(marginPts(pa), 1)}
                      </span>
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground" title="sem dado">n/d</span>
                  )}
                </span>
                {pa != null && <VersusBar pa={pa} cands={cands} h="h-1" className="mt-2" />}
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
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
