// Painel da UF: no celular um Drawer de baixo (vaul), no desktop pela lateral.
import type { Board, HistRow } from '@apuracao/shared';
import { flipped, fmtPct, twoWay, inUf, ufName } from '@apuracao/shared';
import { ArrowRight, Hourglass, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { staticData } from '@/lib/api';
import { fmtCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { leaderOf, marginPts } from './colors';
import { cityHref, pa2022, useAsync, useMedia, useUfMunicipalities, type MapLayer, type MunRow } from './data';
import { MapLegend } from './Legend';
import { MunMap, type MunHit } from './MunMap';
import { CandidateLines, CompareRow, CountedBar, FlipNote, Kpi, pair, RefLegend, SectionTitle, StatusBadge, TransferBlock, VersusBar } from './parts';

export function UfDrawer({ board, uf, onClose }: { board: Board; uf: string | null; onClose: () => void }) {
  const desktop = useMedia('(min-width: 1024px)');
  return (
    <Drawer open={!!uf} onOpenChange={(o) => !o && onClose()} direction={desktop ? 'right' : 'bottom'} repositionInputs={false}>
      <DrawerContent
        className={cn(
          'data-[vaul-drawer-direction=bottom]:h-[88dvh] data-[vaul-drawer-direction=bottom]:max-h-[88dvh] data-[vaul-drawer-direction=right]:w-[440px] data-[vaul-drawer-direction=right]:max-w-[92vw]',
        )}
      >
        {uf && <UfDetail key={uf} board={board} uf={uf} />}
      </DrawerContent>
    </Drawer>
  );
}

function UfDetail({ board, uf }: { board: Board; uf: string }) {
  const cands = board.candidates;
  const live = !!board.released && !!board.br;
  const snap = live ? board.ufs[`uf:${uf}`] : undefined;
  const { data: t1file } = useAsync(() => staticData.hist('t1-2026'), []);
  const { data: y22file } = useAsync(() => staticData.hist('y2022-t2'), []);
  const t1: HistRow | undefined = t1file?.uf[uf];
  const y22: HistRow | undefined = y22file?.uf[uf];
  const pa1 = twoWay(t1, cands);
  const p22 = pa2022(board, y22);
  const flip = snap?.valid && y22 && snap.pst >= 5 ? flipped(snap, y22, board.y2022Map) : null;
  const el = snap?.el || t1?.el || 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <DrawerHeader className="relative border-b px-4 pb-3 pt-2 text-left">
        <div className="flex items-start justify-between gap-3 pr-9">
          <div className="min-w-0 text-left">
            <DrawerTitle className="truncate text-left text-xl font-semibold tracking-tight">{ufName(uf)}</DrawerTitle>
            <DrawerDescription className="num text-left text-xs">
              {uf} · {fmtCompact(el)} eleitores
            </DrawerDescription>
          </div>
          {snap && <StatusBadge s={snap.status} className="shrink-0" />}
        </div>
        <DrawerClose asChild>
          <Button variant="ghost" size="icon" className="absolute right-2 top-2 size-10" aria-label="Fechar">
            <X />
          </Button>
        </DrawerClose>
        {snap && <CountedBar pst={snap.pst} className="mt-3" />}
      </DrawerHeader>

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
              {live ? `Ainda sem urnas apuradas em ${ufName(uf)}.` : `A parcial de ${ufName(uf)} aparece aqui a partir das 17h de domingo.`}
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
            <CompareRow label="1º turno 2026" hint="só os votos dos dois finalistas" pa={pa1} cands={cands} delta={snap?.valid ? (pa1 == null ? null : snap.pa - pa1) : undefined} />
            <CompareRow label="2º turno 2022" hint="mesmos partidos" pa={p22} cands={cands} delta={snap?.valid ? (p22 == null ? null : snap.pa - p22) : undefined} />
          </ul>
          {snap?.valid && <p className="mt-1 text-[12px] text-muted-foreground">À direita: quantos pontos o estado andou na direção de cada um, comparado a cada referência.</p>}
        </section>

        {snap?.valid && t1 && (
          <section className="border-t py-4">
            <SectionTitle>De onde vieram os votos</SectionTitle>
            <TransferBlock snap={snap} t1={t1} cands={cands} place={inUf(uf)} />
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
    <div className="mt-5">
      <h3 className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
        <Hourglass className="size-3.5" aria-hidden />
        Onde mais falta apurar
      </h3>
      <ul className="divide-y">
        {left.map(({ r, rem }) => (
          <li key={r.m.ibge}>
            <Link href={cityHref(r.m)} className="press flex min-h-12 items-center gap-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.m.name}</span>
                <span className="mt-1.5 block h-1 max-w-40 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-foreground/60" style={{ width: `${r.s!.pst}%` }} />
                </span>
              </span>
              <span className="text-right">
                <span className="num block text-sm font-semibold">{fmtCompact(rem)}</span>
                <span className="num block text-[11px] text-muted-foreground">{fmtPct(r.s!.pst, 0)}% apurado</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-muted-foreground">Eleitores ainda não apurados, entre as maiores cidades com parcial coletada.</p>
    </div>
  );
}

function Municipalities({ board, uf, live }: { board: Board; uf: string; live: boolean }) {
  const cands = board.candidates;
  const canLive = live && board.flags.map_mun;
  const [layer, setLayer] = useState<MapLayer>(canLive ? 'live' : 't1');
  const [hit, setHit] = useState<MunHit | null>(null);
  const [all, setAll] = useState(false);
  const { data, loading } = useUfMunicipalities(uf, canLive);
  const abroad = uf === 'ZZ';

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

  const rows = data?.rows ?? [];
  const withLive = rows.filter((r) => r.s?.valid).length;
  const hitRow = hit ? rows.find((r) => r.m.ibge === hit.ibge) : null;
  const hitPa = hitRow ? valueOf(hitRow) : null;
  const shown = rows.slice(0, all ? 80 : 10);

  return (
    <section className="border-t py-4">
      <SectionTitle
        right={
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            value={layer}
            onValueChange={(v) => {
              if (!v) return;
              setLayer(v as MapLayer);
              setHit(null);
            }}
            aria-label="Camada do mapa municipal"
          >
            {canLive && <ToggleGroupItem value="live">Agora</ToggleGroupItem>}
            <ToggleGroupItem value="t1">1º turno</ToggleGroupItem>
            <ToggleGroupItem value="y2022">2022</ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {abroad ? 'Cidades no exterior' : 'Municípios'}
      </SectionTitle>

      {!abroad && (
        <div className="relative">
          <MunMap uf={uf} values={values} cands={cands} highlight={hit?.ibge} onPick={setHit} maxHeight={380} />
          {hit && hitRow && (
            <div
              className="absolute z-10 w-56 -translate-x-1/2 rounded-xl border bg-popover p-3 shadow-lg"
              style={{ left: `clamp(116px, ${hit.x}px, calc(100% - 116px))`, top: Math.max(0, hit.y - 150) }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{hitRow.m.name}</div>
                  <div className="num text-[11px] text-muted-foreground">{fmtCompact(hitRow.m.el)} eleitores</div>
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
            {layer === 'live'
              ? `Toque numa cidade. Em cinza, as que ainda não têm parcial coletada (${withLive} de ${rows.length} até agora).`
              : layer === 't1'
                ? 'Confronto direto entre os dois finalistas no 1º turno de 2026. Toque numa cidade.'
                : '2º turno de 2022, pelos mesmos partidos. Toque numa cidade.'}
          </p>
        </div>
      )}

      {layer === 'live' && !abroad && <WhereLeft rows={rows} />}

      <h3 className="mb-1 mt-5 text-[13px] font-medium text-muted-foreground">Maiores cidades</h3>
      {loading && !data ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
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
                        {fmtCompact(r.m.el)} eleitores
                        {layer === 'live' && r.s && ` · ${fmtPct(r.s.pst, 0)}% apurado`}
                      </span>
                      {pa != null && <VersusBar pa={pa} cands={cands} h="h-1" className="mt-1.5 max-w-40" />}
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
