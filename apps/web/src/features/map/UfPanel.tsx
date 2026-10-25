// Painel da UF: no celular uma gaveta que sobe de baixo (vaul); no desktop um modal no centro. Nunca pela lateral.
import type { Board, HistRow } from '@apuracao/shared';
import { flipped, fmtPct, twoWay, inUf, ufName } from '@apuracao/shared';
import { ArrowRight, Hourglass, X } from 'lucide-react';
import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { DataTip } from '@/components/core/datatip';
import { LineBone } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerTitle } from '@/components/ui/drawer';
import { VoteTotals } from '@/features/score/VoteTotals';
import { UfProjection } from '@/features/score/Projection';
import { staticData } from '@/lib/api';
import { fmtCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { dotGeo, useDots } from './citydata';
import { leaderOf, marginPts } from './colors';
import { cityHref, pa2022, useAsync, useMedia, useUfMunicipalities, type MapLayer, type MunRow } from './data';
import { MapLegend } from './Legend';
import HexMap from './HexMap';
import { ABROAD } from './abroad-coords';
import type { WorldCity, WorldHit } from './WorldMap';
import { CandidateLines, CompareRow, CountedBar, FlipNote, Kpi, ofUf, pair, RefLegend, SectionTitle, StatusBadge, TransferBlock, TransferSkeleton, VersusBar } from './parts';
import { matchup2022 } from '@/lib/y2022';
import { LayerChips } from './LayerChips';

const WorldMap = lazy(() => import('./WorldMap'));

/** um traço de texto fantasma no meio da linha (ex.: o eleitorado no subtítulo) */
const inlineBone = 'inline-block h-[0.8em] animate-pulse rounded-sm bg-accent align-middle';

export function UfPanel({ board, uf, onClose }: { board: Board; uf: string | null; onClose: () => void }) {
  const desktop = useMedia('(min-width: 1024px)');
  if (desktop)
    return (
      <Dialog open={!!uf} onOpenChange={(o) => !o && onClose()}>
        <DialogContent showCloseButton={false} className="flex h-[min(88dvh,880px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
          {uf && <UfDetail key={uf} board={board} uf={uf} desktop />}
        </DialogContent>
      </Dialog>
    );
  return (
    <Drawer open={!!uf} onOpenChange={(o) => !o && onClose()} repositionInputs={false}>
      <DrawerContent className="data-[vaul-drawer-direction=bottom]:h-[88dvh] data-[vaul-drawer-direction=bottom]:max-h-[88dvh]">
        {uf && <UfDetail key={uf} board={board} uf={uf} desktop={false} />}
      </DrawerContent>
    </Drawer>
  );
}

function UfDetail({ board, uf, desktop }: { board: Board; uf: string; desktop: boolean }) {
  // título, descrição e fechar do mesmo componente de fora (modal ou gaveta), para leitor de tela e foco
  const Title = desktop ? DialogTitle : DrawerTitle;
  const Desc = desktop ? DialogDescription : DrawerDescription;
  const Close = desktop ? DialogClose : DrawerClose;
  const cands = board.candidates;
  const live = !!board.released && !!board.br;
  const snap = live ? board.ufs[`uf:${uf}`] : undefined;
  const { data: t1file, loading: t1Loading } = useAsync(() => staticData.hist('t1-2026'), []);
  const { data: y22file, loading: y22Loading } = useAsync(() => staticData.hist('y2022-t2'), []);
  // o histórico (1º turno, 2022) chega depois de abrir: enquanto isso, cada bloco que depende dele fica em fantasma no tamanho final
  const t1Wait = !t1file && t1Loading;
  const y22Wait = !y22file && y22Loading;
  const t1: HistRow | undefined = t1file?.uf[uf];
  const y22: HistRow | undefined = y22file?.uf[uf];
  const pa1 = twoWay(t1, cands);
  const p22 = pa2022(board, y22);
  const flip = snap?.valid && y22 && snap.pst >= 5 ? flipped(snap, y22, board.y2022Map) : null;
  const el = snap?.el || t1?.el || 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('relative border-b px-4 pb-3 text-left', desktop ? 'pt-4' : 'pt-2')}>
        <div className="flex items-start justify-between gap-3 pr-9">
          <div className="min-w-0 text-left">
            <Title className="truncate text-left text-xl font-semibold tracking-tight">{ufName(uf)}</Title>
            <Desc className="num text-left text-xs text-muted-foreground">
              {uf === 'ZZ' ? 'Todos os países' : uf} · {!el && t1Wait ? <span className={cn(inlineBone, 'w-10')} aria-hidden /> : fmtCompact(el)} eleitores
            </Desc>
          </div>
          {snap && <StatusBadge s={snap.status} className="shrink-0" />}
        </div>
        <Close asChild>
          <Button variant="ghost" size="icon" className="absolute right-2 top-2 size-10" aria-label="Fechar">
            <X />
          </Button>
        </Close>
        {snap && <CountedBar pst={snap.pst} className="mt-3" />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        {snap?.valid && (
          <section className="grid grid-cols-4 gap-3 border-b py-3">
            <Kpi label="Válidos" value={fmtCompact(snap.valid)} hint="já apurados" />
            <Kpi label="Diferença" value={fmtCompact(Math.abs(snap.a - snap.b))} hint="votos" />
            <Kpi label="Faltam" value={`~${fmtCompact(snap.rem)}`} hint="votos válidos" />
            <Kpi label="Compareceu" value={snap.elc ? `${fmtPct((snap.turnout / snap.elc) * 100, 0)}%` : '—'} hint={t1 && t1.el ? `1º t.: ${fmtPct((t1.turnout / t1.el) * 100, 0)}%` : undefined} />
          </section>
        )}
        <section className="py-4">
          {snap?.valid ? (
            <>
              <CandidateLines cands={cands} snap={snap} />
              <UfProjection board={board} uf={uf} />
              <div className="mt-5">
                <h3 className="mb-2 text-[13px] font-semibold">Votos apurados</h3>
                <VoteTotals snap={snap} />
              </div>
              {pa1 == null && p22 == null && (t1Wait || y22Wait) && (
                // mesmo cartão (barra com as marcas + legenda de uma linha), em fantasma
                <div className="mt-4 rounded-xl bg-muted/50 p-3" aria-hidden>
                  <div className="h-2 animate-pulse rounded-full bg-accent" />
                  <LineBone className="mt-2.5 text-[11px]" w="w-56" />
                </div>
              )}
              {(pa1 != null || p22 != null) && (
                <div className="mt-4 rounded-xl bg-muted/50 p-3">
                  <VersusBar
                    pa={snap.pa}
                    cands={cands}
                    h="h-2"
                    refs={[
                      ...(pa1 != null ? [{ pa: pa1, tag: 't1', label: '1º turno' }] : []),
                      ...(p22 != null ? [{ pa: p22, tag: 'y22', label: '2022' }] : []),
                    ]}
                  />
                  <RefLegend
                    className="mt-2.5"
                    cands={cands}
                    refs={[
                      ...(pa1 != null ? [{ pa: pa1, tag: 't1', label: '1º turno' }] : []),
                      ...(p22 != null ? [{ pa: p22, tag: 'y22', label: '2022' }] : []),
                    ]}
                  />
                </div>
              )}
            </>
          ) : (
            <p className="rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground">
              {live ? `Ainda sem urnas apuradas ${inUf(uf)}.` : `A parcial ${ofUf(uf)} aparece aqui a partir das 17h de domingo.`}
            </p>
          )}
        </section>

        <section className="border-t py-4">
          <SectionTitle>Em contexto</SectionTitle>
          {flip && (
            <div className="mb-3">
              <FlipNote place={ufName(uf)} from={cands.find((c) => c.key === flip.from)!} to={cands.find((c) => c.key === flip.to)!} />
            </div>
          )}
          <ul className="divide-y">
            {snap?.valid && (
              <CompareRow label={`${ufName(uf)} agora`} hint={`${fmtPct(snap.pst, 1)}% apurado`} pa={snap.pa} cands={cands} strong delta={snap?.valid ? 0 : undefined} />
            )}
            {live && board.br?.valid ? (
              <CompareRow label="Brasil agora" hint={`${fmtPct(board.br.pst, 1)}% apurado`} pa={board.br.pa} cands={cands} delta={snap?.valid ? snap.pa - board.br.pa : undefined} />
            ) : null}
            <CompareRow label="1º turno 2026" hint="só os votos dos dois finalistas" pa={pa1} cands={cands} loading={t1Wait} delta={snap?.valid ? (pa1 == null ? null : snap.pa - pa1) : undefined} />
            <CompareRow label="2º turno 2022" hint={matchup2022(board)} pa={p22} cands={cands} loading={y22Wait} delta={snap?.valid ? (p22 == null ? null : snap.pa - p22) : undefined} />
          </ul>
          {snap?.valid && <p className="mt-1 text-[12px] text-muted-foreground">À direita: quantos pontos o estado andou na direção de cada um, comparado a cada referência.</p>}
        </section>

        {snap?.valid && (t1 || t1Wait) && (
          <section className="border-t py-4">
            <SectionTitle>De onde vieram os votos</SectionTitle>
            {t1 ? <TransferBlock snap={snap} t1={t1} cands={cands} place={inUf(uf)} /> : <TransferSkeleton />}
          </section>
        )}

        <Municipalities board={board} uf={uf} live={live} />
        <div className="pt-2">
          <SourceStamp at={snap?.at ?? board.source.at} />
        </div>
      </div>
    </div>
  );
}

/**
 * Onde ainda falta apurar dentro da UF: maiores eleitorados não apurados entre as cidades com parcial coletada.
 * O poller só coleta as maiores cidades, então o texto deixa claro que é um recorte.
 */
function WhereLeft({ rows }: { rows: MunRow[] }) {
  const left = rows
    .filter((r) => r.s && r.s.pst < 100)
    .map((r) => ({ r, rem: Math.max(0, r.s!.el - r.s!.elc) }))
    .filter((x) => x.rem > 0)
    .sort((a, b) => b.rem - a.rem)
    .slice(0, 5);
  if (!left.length) return null;
  return (
    <WhereLeftFrame>
      <ul className="divide-y">
        {left.map(({ r, rem }) => (
          <li key={r.m.ibge}>
            <Link href={cityHref(r.m)} className="press flex min-h-12 items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.m.name}</span>
                <DataTip nested className="mt-1.5 max-w-40" label={`${fmtPct(r.s!.pst, 0)}% apurado`} tip={<span className="num">{fmtPct(r.s!.pst, 1)}% apurado</span>}>
                  <span className="block h-1 overflow-hidden rounded-full bg-muted" aria-hidden>
                    <span className="block h-full rounded-full bg-foreground/60" style={{ width: `${r.s!.pst}%` }} />
                  </span>
                </DataTip>
              </span>
              <span className="text-right">
                <span className="num block text-sm font-semibold">{fmtCompact(rem)}</span>
                <span className="num block text-[11px] text-muted-foreground">{fmtPct(r.s!.pst, 0)}% apurado</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </WhereLeftFrame>
  );
}

function WhereLeftFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mt-5">
      <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        <Hourglass className="size-3.5" aria-hidden />
        Onde mais falta apurar
      </h3>
      {children}
      <p className="text-[12px] text-muted-foreground">Eleitores ainda não apurados, entre as maiores cidades com parcial coletada.</p>
    </div>
  );
}

/** "Onde mais falta apurar" em fantasma: o mesmo título, 5 linhas da mesma altura e a mesma nota */
function WhereLeftSkeleton() {
  return (
    <WhereLeftFrame>
      <ul className="divide-y" aria-hidden>
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i} className="flex min-h-12 items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <LineBone className="text-sm" w={ROW_W[i % ROW_W.length]} />
              <span className="mt-1.5 block h-1 max-w-40 animate-pulse rounded-full bg-accent" />
            </span>
            <span className="text-right">
              <LineBone className="text-sm" w="w-10" />
              <LineBone className="text-[11px]" w="w-16" />
            </span>
          </li>
        ))}
      </ul>
    </WhereLeftFrame>
  );
}

const ROW_W = ['w-32', 'w-24', 'w-36', 'w-28', 'w-20'];

/** "Maiores cidades" em fantasma: linhas com nome, eleitorado, barra e a margem à direita, como as de verdade */
function CityListSkeleton({ rows, more }: { rows: number; more: boolean }) {
  return (
    <div aria-busy="true" aria-label="Carregando cidades">
      <ul className="divide-y" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <li key={i} className="flex min-h-13 items-center gap-3 py-2">
            <span className="min-w-0 flex-1">
              <LineBone className="text-sm" w={ROW_W[i % ROW_W.length]} />
              <LineBone className="text-[11px]" w="w-24" />
              <span className="mt-1.5 block h-1 max-w-40 animate-pulse rounded-full bg-accent" />
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <span className="size-6 animate-pulse rounded-md bg-accent" />
              <LineBone className="w-12 text-right text-sm" w="w-9" />
            </span>
          </li>
        ))}
      </ul>
      {more && <div className="mt-2 h-11 w-full animate-pulse rounded-md bg-accent" />}
    </div>
  );
}

/**
 * Altura/largura da caixa da UF no mapa de hexágonos (mesma conta do HexMap: caixa do contorno + 3% de folga),
 * para reservar o espaço do mapa antes dele carregar. Sem o dots.json ainda, usa a tabela medida nele.
 */
const UF_RATIO: Record<string, number> = {
  RO: 0.838, AC: 0.581, AM: 0.702, RR: 1.149, PA: 0.974, AP: 1.14, TO: 1.61, MA: 1.307, PI: 1.421, CE: 1.205, RN: 0.609, PB: 0.602, PE: 0.379, AL: 0.576,
  SE: 1.127, BA: 1.088, MG: 0.828, ES: 1.584, RJ: 0.731, SP: 0.688, PR: 0.723, SC: 0.715, RS: 0.979, MS: 1.017, MT: 0.964, GO: 1.004, DF: 0.612,
};

function useUfRatio(uf: string) {
  const { dots } = useDots();
  return useMemo(() => {
    const b = dots ? dotGeo(dots).ufBox[uf] : undefined;
    if (!b) return UF_RATIO[uf] ?? 1;
    const pad = Math.max(b[2] - b[0], b[3] - b[1]) * 0.03;
    return (b[3] - b[1] + 2 * pad) / (b[2] - b[0] + 2 * pad);
  }, [dots, uf]);
}

function Municipalities({ board, uf, live }: { board: Board; uf: string; live: boolean }) {
  const cands = board.candidates;
  const canLive = live && board.flags.map_mun;
  const [layer, setLayer] = useState<MapLayer>(canLive ? 'live' : 't1');
  const [hit, setHit] = useState<WorldHit | null>(null);
  const [all, setAll] = useState(false);
  const { data, loading } = useUfMunicipalities(uf, canLive);
  const abroad = uf === 'ZZ';
  const ratio = useUfRatio(uf);
  const waiting = loading && !data;
  // "onde mais falta apurar" só aparece com a UF ainda apurando: o fantasma também
  const ufPst = board.ufs[`uf:${uf}`]?.pst;
  const leftPending = ufPst != null && ufPst < 100;

  const valueOf = (r: MunRow): number | null => {
    if (layer === 'live') return r.s?.valid ? r.s.pa : null;
    if (layer === 't1') return twoWay(r.t1, cands);
    return pa2022(board, r.y22);
  };
  const values = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const r of data?.rows ?? []) out[r.m.ibge] = valueOf(r);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, layer, board.y2022Map]);

  const worldCities = useMemo<WorldCity[]>(
    () => (abroad ? (data?.rows ?? []).map((r) => ({ ibge: r.m.ibge, tse: r.m.tse, name: r.m.name, el: r.m.el, pa: values[r.m.ibge] ?? null })) : []),
    [abroad, data, values],
  );

  const rows = data?.rows ?? [];
  const withLive = rows.filter((r) => r.s?.valid).length;
  const hitRow = hit ? rows.find((r) => r.m.ibge === hit.ibge) : null;
  const hitPa = hitRow ? valueOf(hitRow) : null;
  const shown = rows.slice(0, all ? 80 : 10);

  return (
    <section className="border-t py-4">
      <SectionTitle
        right={
          <LayerChips
            value={layer}
            onChange={(v) => {
              setLayer(v);
              setHit(null);
            }}
            cands={cands}
            live={canLive}
            who22={matchup2022(board)}
            label={null}
          />
        }
      >
        {abroad ? 'Cidades no exterior' : 'Municípios'}
      </SectionTitle>

      <div className="relative">
        {abroad ? (
          // mundo: caixa na proporção do recorte do WorldMap (Natural Earth, 72°N a 50°S) enquanto ele carrega
          <div className="w-full overflow-hidden rounded-xl" style={{ aspectRatio: '1 / 0.385', maxHeight: 320 }}>
            <Suspense fallback={<div className="size-full animate-pulse rounded-xl bg-muted/60" />}>
              <WorldMap cities={worldCities} cands={cands} highlight={hit?.ibge} onPick={setHit} maxHeight={320} />
            </Suspense>
          </div>
        ) : (
          // caixa já no tamanho final do mapa (proporção da UF, até 380px): o fantasma do HexMap fica dentro dela
          <div className="w-full overflow-hidden rounded-xl" style={{ aspectRatio: `1 / ${ratio}`, maxHeight: 380 }}>
            <HexMap cands={cands} layer={layer} scope={uf} highlight={hit?.ibge} onPick={setHit} onHover={(h) => h && setHit(h)} maxHeight={380} label={`Mapa ${inUf(uf)} em hexágonos, na cor de quem lidera em cada região`} />
          </div>
        )}
        {hit && hitRow && (
          // no mundo (mapa baixo) o cartão fica logo abaixo do mapa, sem cobrir as cidades; nas UFs, flutua sobre o toque
          <div
            className={cn('rounded-xl border bg-popover p-3 shadow-lg', abroad ? 'mt-2' : 'absolute z-10 w-56 -translate-x-1/2')}
            style={abroad ? undefined : { left: `clamp(116px, ${hit.x}px, calc(100% - 116px))`, top: Math.max(0, hit.y - 150) }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{hitRow.m.name}</div>
                <div className="num truncate text-[11px] text-muted-foreground">
                  {abroad && ABROAD[hitRow.m.tse] ? `${ABROAD[hitRow.m.tse][2]} · ` : ''}
                  {fmtCompact(hitRow.m.el)} eleitores
                </div>
              </div>
              <button type="button" onClick={() => setHit(null)} className="-mr-1 -mt-1 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-accent" aria-label="Fechar">
                <X className="size-4" />
              </button>
            </div>
            {hitPa != null ? (
              <div className="num mt-2 flex justify-between text-sm font-semibold">
                <span style={{ color: cands[0].color }}>{pair(hitPa)[0]}%</span>
                <span style={{ color: cands[1].color }}>{pair(hitPa)[1]}%</span>
              </div>
            ) : (
              <div className="mt-2 text-xs text-muted-foreground">{layer === 'live' ? 'Parcial ainda não coletada' : 'Sem dado'}</div>
            )}
            <Button asChild size="sm" variant="secondary" className="mt-2 h-9 w-full">
              <Link href={cityHref(hitRow.m)}>
                Ver a cidade <ArrowRight />
              </Link>
            </Button>
          </div>
        )}
        <MapLegend cands={cands} compact className="mt-3" />
        <p className="mt-2 text-center text-[12px] text-muted-foreground">
          {abroad
            ? layer === 'live'
              ? `Todos os países somados no placar. Toque numa cidade para ver como votou (${withLive} de ${rows.length} com parcial).`
              : layer === 't1'
                ? 'Confronto direto entre os dois finalistas no 1º turno de 2026. Toque numa cidade.'
                : `2º turno de 2022: ${matchup2022(board)}. Toque numa cidade.`
            : layer === 'live'
              ? `Toque numa cidade. O hexágono cresce conforme a região é apurada (${withLive} de ${rows.length} cidades com parcial).`
              : layer === 't1'
                ? 'Confronto direto entre os dois finalistas no 1º turno de 2026. Toque numa cidade.'
                : `2º turno de 2022: ${matchup2022(board)}. Toque numa cidade.`}
        </p>
      </div>

      {layer === 'live' && !abroad && (waiting ? leftPending && <WhereLeftSkeleton /> : <WhereLeft rows={rows} />)}

      <h3 className="mb-1 mt-5 text-[13px] font-medium text-muted-foreground">Maiores cidades</h3>
      {waiting ? (
        // 10 linhas + "Ver mais" (o DF só tem Brasília)
        <CityListSkeleton rows={uf === 'DF' ? 1 : 10} more={uf !== 'DF'} />
      ) : !rows.length ? (
        <p className="py-4 text-sm text-muted-foreground">Lista de cidades indisponível agora.</p>
      ) : (
        <>
          <ul className="divide-y">
            {shown.map((r) => {
              const pa = valueOf(r);
              const lead = pa != null ? leaderOf(pa, cands) : null;
              return (
                <li key={r.m.ibge}>
                  <Link href={cityHref(r.m)} className="press flex min-h-13 items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{r.m.name}</span>
                      <span className="num block text-[11px] text-muted-foreground">
                        {abroad && ABROAD[r.m.tse] ? `${ABROAD[r.m.tse][2]} · ` : ''}
                        {fmtCompact(r.m.el)} eleitores
                        {layer === 'live' && r.s && ` · ${fmtPct(r.s.pst, 0)}% apurado`}
                      </span>
                      {pa != null && <VersusBar pa={pa} cands={cands} h="h-1" className="mt-1.5 max-w-40" title={r.m.name} nested />}
                    </span>
                    {lead && pa != null ? (
                      <span className="flex shrink-0 items-center gap-2">
                        <CandidateAvatar c={lead} size="xs" />
                        <span className="num w-12 text-right text-sm font-semibold" style={{ color: lead.color }}>
                          +{fmtPct(marginPts(pa), 1)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">{layer === 'live' ? 'aguardando' : '—'}</span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          {rows.length > shown.length && (
            <Button variant="outline" className="mt-2 h-11 w-full" onClick={() => setAll(true)}>
              Ver mais cidades
            </Button>
          )}
        </>
      )}
    </section>
  );
}
