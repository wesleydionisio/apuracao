// Aba Mapa: grade de hexágonos por cidade (padrão), pontos, hexágonos por estado ou lista; tocar num estado abre o painel da UF.
// Camadas: Agora | 1º turno | 2022. Com "Agora", dá para comparar com uma referência e pintar o deslocamento.
import type { Board } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { GitCompareArrows, Hexagon, Map as MapIcon, Rows3 } from 'lucide-react';
import { lazy, Suspense, useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { SourceStamp } from '@/components/core/live';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { REF_LABEL, swingOf, swingValues, useStateValues, useUfRefs, type MapLayer, type RefLayer } from '@/features/map/data';
import { MapLegend } from '@/features/map/Legend';
import { MapRankings } from '@/features/map/Rankings';
import { StateList } from '@/features/map/StateList';
import { StateTally } from '@/features/map/Tally';
import { UfPanel } from '@/features/map/UfPanel';
import { UfTip } from '@/features/map/UfTip';
import type { HexHit } from '@/features/map/HexMap';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { MapSkeleton } from '@/components/skeletons';

type View = 'hex' | 'map' | 'list';
const VIEW_KEY = 'map:view';
const CityMap = lazy(() => import('@/features/map/CityMap'));
const HexMap = lazy(() => import('@/features/map/HexMap'));

function savedView(): View {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    // 'heat' (mapa de calor) e 'dots' (pontos por cidade) saíram: caem na grade de hexágonos
    return v === 'map' || v === 'list' || v === 'hex' ? v : 'hex';
  } catch {
    return 'hex';
  }
}

const COMPARE_KEY = 'map:compare';
const TITLES = [
  'Quem lidera em cada estado',
  'Como cada estado votou no 1º turno',
  'Como cada estado votou em 2022',
  'Para onde cada estado andou desde o 1º turno',
  'Para onde cada estado andou desde 2022',
];
/** todas as legendas que o mapa pode mostrar (reservam o espaço da maior) */
const CAPTIONS = [
  'Parcial do 2º turno, votos válidos.',
  'Confronto direto entre os dois finalistas no 1º turno de 2026.',
  '2º turno de 2022, pelos mesmos partidos.',
  'Cor de quem ganhou terreno; mais forte quanto maior o deslocamento. Compare a parcial com o 1º turno.',
  'Cor de quem ganhou terreno; mais forte quanto maior o deslocamento. Compare a parcial com 2022.',
];

function savedCompare(): RefLayer | null {
  try {
    const v = localStorage.getItem(COMPARE_KEY);
    return v === 't1' || v === 'y2022' ? v : null;
  } catch {
    return null;
  }
}

export default function MapPage() {
  const board = useBoard((s) => s.board);
  if (!board) return <MapSkeleton />;
  return <MapView board={board} />;
}

const segItem = 'rounded-md! px-3 data-[state=on]:bg-card data-[state=on]:shadow-sm';

function MapView({ board }: { board: Board }) {
  const params = useParams<{ uf?: string }>();
  const [, nav] = useLocation();
  const [view, setViewState] = useState<View>(savedView);
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* sem storage */
    }
  };
  const live = !!board.released && !!board.br;
  /** grade e pontos: mapas por cidade (a comparação por estado não se aplica) */
  const byCity = view === 'hex';
  // sem escolha do usuário a camada acompanha a liberação (17h); escolhida, fica
  const [layer, setLayer] = useState<MapLayer | null>(null);
  const effective: MapLayer = layer === null || (layer === 'live' && !live) ? (live ? 'live' : 't1') : layer;
  const [compare, setCompareState] = useState<RefLayer | null>(savedCompare);
  const setCompare = (v: RefLayer | null) => {
    setCompareState(v);
    try {
      if (v) localStorage.setItem(COMPARE_KEY, v);
      else localStorage.removeItem(COMPARE_KEY);
    } catch {
      /* sem storage */
    }
  };
  const { values } = useStateValues(board, effective);
  const { refs, t1 } = useUfRefs(board);
  const selected = params.uf?.toUpperCase() ?? null;
  const cands = board.candidates;

  // referência para "quem mais mudou": a escolhida; sem escolha, 2022 (ou o 1º turno quando a camada já é 2022)
  const rankRef: RefLayer = effective === 'live' ? (compare ?? 'y2022') : effective === 't1' ? 'y2022' : 't1';
  const swing = useMemo(() => swingOf(values, refs[rankRef]), [values, refs, rankRef]);
  const swingMode = effective === 'live' && compare !== null;
  const mapValues = useMemo(() => (swingMode ? swingValues(values, refs[compare!]) : values), [swingMode, values, refs, compare]);

  const electorate = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [uf, h] of Object.entries(t1?.uf ?? {})) out[uf] = h.el;
    for (const [k, s] of Object.entries(board.ufs)) if (s.el) out[k.slice(3)] = s.el;
    return out;
  }, [t1, board.ufs]);

  const pick = (uf: string) => nav(`/mapa/${uf}`, { replace: !!selected });
  const [tip, setTip] = useState<HexHit | null>(null);
  const close = () => nav('/mapa', { replace: true });

  const title = swingMode
    ? `Para onde cada estado andou desde ${compare === 't1' ? 'o 1º turno' : '2022'}`
    : effective === 'live'
      ? 'Quem lidera em cada estado'
      : effective === 't1'
        ? 'Como cada estado votou no 1º turno'
        : 'Como cada estado votou em 2022';
  const caption = swingMode
    ? `Cor de quem ganhou terreno; mais forte quanto maior o deslocamento. Compare a parcial com ${REF_LABEL[compare!]}.`
    : effective === 'live'
      ? 'Parcial do 2º turno, votos válidos.'
      : effective === 't1'
        ? 'Confronto direto entre os dois finalistas no 1º turno de 2026.'
        : '2º turno de 2022, pelos mesmos partidos.';
  const tipRefs = (['t1', 'y2022'] as RefLayer[])
    .filter((r) => !(effective === r))
    .map((r) => ({ label: r === 't1' ? '1º turno' : '2022', values: refs[r] }));

  return (
    <div className="space-y-4 pb-2">
      <header className="flex items-end justify-between gap-3 pt-1">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Presidente, 2º turno, por estado</p>
          {/* todos os títulos possíveis empilhados, só o ativo visível: trocar a camada não muda a altura */}
          <h1 className="grid text-[22px] font-semibold leading-tight tracking-tight text-balance [&>*]:col-start-1 [&>*]:row-start-1">
            {[...new Set([title, ...TITLES])].map((t) => (
              <span key={t} className={t === title ? undefined : 'invisible'} aria-hidden={t !== title}>
                {t}
              </span>
            ))}
          </h1>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Ver como">
          <ToggleGroupItem value="hex" aria-label="Grade de hexágonos">
            <Hexagon />
          </ToggleGroupItem>
          <ToggleGroupItem value="map" aria-label="Estados">
            <MapIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Lista">
            <Rows3 />
          </ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <ToggleGroup type="single" size="sm" value={effective} onValueChange={(v) => v && setLayer(v as MapLayer)} aria-label="Camada" className="rounded-lg bg-muted p-0.5">
            {live && (
              <ToggleGroupItem value="live" className={segItem}>
                Agora
              </ToggleGroupItem>
            )}
            <ToggleGroupItem value="t1" className={segItem}>
              1º turno
            </ToggleGroupItem>
            <ToggleGroupItem value="y2022" className={segItem}>
              2022
            </ToggleGroupItem>
          </ToggleGroup>
          {effective === 'live' && board.br && <span className="num text-xs text-muted-foreground">{fmtPct(board.br.pst, 1)}% apurado</span>}
        </div>
        {/* sempre no lugar; fora da camada "Agora" fica invisível (não empurra o resto) */}
        {(
          <div
            className={cn('flex items-center gap-2', (effective !== 'live' || byCity) && 'invisible')}
            role="group"
            aria-label="Comparar com"
            aria-hidden={effective !== 'live' || byCity}
          >
            <GitCompareArrows className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="text-xs text-muted-foreground">Comparar com</span>
            {(['t1', 'y2022'] as RefLayer[]).map((r) => {
              const on = compare === r;
              return (
                <button
                  key={r}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setCompare(on ? null : r)}
                  className={cn(
                    'press inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors',
                    on ? 'border-foreground bg-foreground text-background' : 'bg-card text-muted-foreground hover:text-foreground',
                  )}
                >
                  {REF_LABEL[r]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <StateTally
        values={values}
        electorate={electorate}
        cands={cands}
        caption={effective === 'live' ? 'Estados liderados agora · o que decide é o voto total' : effective === 't1' ? 'Estados vencidos no 1º turno' : 'Estados vencidos em 2022'}
      />

      {byCity ? (
        <section className="rounded-2xl border bg-card p-3 sm:p-5">
          <Suspense fallback={<Skeleton className="aspect-[1000/1051] w-full rounded-xl" />}>
            <CityMap layer={effective} cands={cands} className="mx-auto max-w-[620px]" />
          </Suspense>
        </section>
      ) : view === 'map' ? (
        <section className="rounded-2xl border bg-card p-3 sm:p-5">
          <div className="relative mx-auto max-w-[620px]">
            <Suspense fallback={<Skeleton className="aspect-[1000/1051] w-full rounded-xl" />}>
              <HexMap
                cands={cands}
                ufValues={mapValues}
                labels
                selectedUf={selected}
                onPick={(hit) => hit && pick(hit.uf)}
                onHover={setTip}
                label={swingMode ? 'Mapa do deslocamento por estado, em hexágonos' : 'Mapa do Brasil em hexágonos, na cor de quem lidera em cada estado'}
              />
            </Suspense>
            {tip && <UfTip uf={tip.uf} x={tip.x} y={tip.y} value={values[tip.uf]} cands={cands} refs={tipRefs} />}
          </div>
          <MapLegend
            cands={cands}
            className="mt-3"
            caption={swingMode ? `Deslocamento desde ${REF_LABEL[compare!]}, em pontos` : undefined}
            ghost={`Deslocamento desde ${REF_LABEL.y2022.length > REF_LABEL.t1.length ? REF_LABEL.y2022 : REF_LABEL.t1}, em pontos`}
          />
          {/* todas as legendas possíveis no mesmo lugar, só a ativa visível: a altura não muda com os filtros, em qualquer largura */}
          <div className="mt-3 grid text-center text-xs text-pretty text-muted-foreground [&>*]:col-start-1 [&>*]:row-start-1">
            {[...new Set([caption, ...CAPTIONS])].map((c) => (
              <p key={c} className={c === caption ? undefined : 'invisible'} aria-hidden={c !== caption}>
                {c} Toque num estado para ver as cidades.
              </p>
            ))}
          </div>
          {values.ZZ?.pa != null && (
            <button type="button" onClick={() => pick('ZZ')} className="press mx-auto mt-3 flex min-h-10 items-center gap-2 rounded-full border px-3 text-xs">
              Exterior
              <span className="num font-semibold" style={{ color: values.ZZ.pa >= 50 ? cands[0].color : cands[1].color }}>
                {fmtPct(Math.max(values.ZZ.pa, 100 - values.ZZ.pa), 1)}%
              </span>
            </button>
          )}
        </section>
      ) : (
        <StateList
          values={values}
          electorate={electorate}
          cands={cands}
          onPick={pick}
          showPst={effective === 'live'}
          swing={effective === 'live' && compare ? swingOf(values, refs[compare]) : undefined}
          swingLabel={compare ? REF_LABEL[compare] : undefined}
        />
      )}

      <MapRankings values={values} swing={swing} refLabel={REF_LABEL[rankRef]} cands={cands} onPick={pick} />

      <SourceStamp at={board.source.at} />
      <UfPanel board={board} uf={selected} onClose={close} />
    </div>
  );
}

