// Aba Mapa: mapa real do Brasil (padrão) ou lista de estados; toque abre o painel da UF.
import type { Board, CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { Map as MapIcon, Rows3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { BrazilMap } from '@/features/map/BrazilMap';
import { useAsync, useStateValues, type MapLayer, type UfValue } from '@/features/map/data';
import { MapLegend } from '@/features/map/Legend';
import { StateList } from '@/features/map/StateList';
import { UfDrawer } from '@/features/map/UfDrawer';
import { staticData } from '@/lib/api';
import { useBoard } from '@/store/board';

type View = 'map' | 'list';

export default function MapPage() {
  const board = useBoard((s) => s.board);
  if (!board) return <MapSkeleton />;
  return <MapView board={board} />;
}

function MapView({ board }: { board: Board }) {
  const params = useParams<{ uf?: string }>();
  const [, nav] = useLocation();
  const [view, setView] = useState<View>('map');
  const live = !!board.released && !!board.br;
  // sem escolha do usuário a camada acompanha a liberação (17h); escolhida, fica
  const [layer, setLayer] = useState<MapLayer | null>(null);
  const effective: MapLayer = layer === null || (layer === 'live' && !live) ? (live ? 'live' : 't1') : layer;
  const { values } = useStateValues(board, effective);
  const { data: t1 } = useAsync(() => staticData.hist('t1-2026'), []);
  const selected = params.uf?.toUpperCase() ?? null;
  const cands = board.candidates;

  const electorate = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [uf, h] of Object.entries(t1?.uf ?? {})) out[uf] = h.el;
    for (const [k, s] of Object.entries(board.ufs)) if (s.el) out[k.slice(3)] = s.el;
    return out;
  }, [t1, board.ufs]);

  const pick = (uf: string) => nav(`/mapa/${uf}`, { replace: !!selected });
  const close = () => nav('/mapa', { replace: true });

  const title =
    effective === 'live' ? 'Quem lidera em cada estado' : effective === 't1' ? 'Como cada estado votou no 1º turno' : 'Como cada estado votou em 2022';
  const caption =
    effective === 'live'
      ? 'Parcial do 2º turno, votos válidos.'
      : effective === 't1'
        ? 'Confronto direto entre os dois finalistas no 1º turno de 2026.'
        : '2º turno de 2022, pelos mesmos partidos.';

  return (
    <div className="space-y-4 pb-2">
      <header className="flex items-end justify-between gap-3 pt-1">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Presidente · 2º turno</p>
          <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        </div>
        <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && setView(v as View)} aria-label="Ver como">
          <ToggleGroupItem value="map" aria-label="Mapa">
            <MapIcon />
          </ToggleGroupItem>
          <ToggleGroupItem value="list" aria-label="Lista">
            <Rows3 />
          </ToggleGroupItem>
        </ToggleGroup>
      </header>

      <div className="flex items-center justify-between gap-2">
        <ToggleGroup type="single" size="sm" value={effective} onValueChange={(v) => v && setLayer(v as MapLayer)} aria-label="Camada" className="rounded-lg bg-muted p-0.5">
          {live && (
            <ToggleGroupItem value="live" className="rounded-md! data-[state=on]:bg-card data-[state=on]:shadow-sm">
              Agora
            </ToggleGroupItem>
          )}
          <ToggleGroupItem value="t1" className="rounded-md! data-[state=on]:bg-card data-[state=on]:shadow-sm">
            1º turno
          </ToggleGroupItem>
          <ToggleGroupItem value="y2022" className="rounded-md! data-[state=on]:bg-card data-[state=on]:shadow-sm">
            2022
          </ToggleGroupItem>
        </ToggleGroup>
        {effective === 'live' && board.br && <span className="num text-xs text-muted-foreground">{fmtPct(board.br.pst, 1)}% apurado</span>}
      </div>

      <Tally values={values} cands={cands} />

      {view === 'map' ? (
        <section className="rounded-2xl border bg-card p-3 sm:p-5">
          <BrazilMap values={values} cands={cands} selected={selected} onPick={pick} className="mx-auto max-w-[520px]" />
          <MapLegend cands={cands} className="mt-3" />
          <p className="mt-3 text-center text-xs text-muted-foreground">{caption} Toque num estado para ver as cidades.</p>
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
        <StateList values={values} electorate={electorate} cands={cands} onPick={pick} showPst={effective === 'live'} />
      )}

      <SourceStamp at={board.source.at} />
      <UfDrawer board={board} uf={selected} onClose={close} />
    </div>
  );
}

/** "lidera em N estados" — contagem por candidato com foto */
function Tally({ values, cands }: { values: Record<string, UfValue | undefined>; cands: CandidateDef[] }) {
  let a = 0;
  let b = 0;
  for (const [uf, v] of Object.entries(values)) {
    if (uf === 'ZZ' || v?.pa == null) continue;
    if (v.pa > 50) a++;
    else if (v.pa < 50) b++;
  }
  const rest = 27 - a - b;
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        { c: cands[0], n: a },
        { c: cands[1], n: b },
      ].map(({ c, n }) => (
        <div key={c.key} className="flex items-center gap-3 rounded-xl border bg-card p-3">
          <CandidateAvatar c={c} size="md" />
          <div className="min-w-0">
            <div className="flex items-baseline gap-1">
              <span className="display text-2xl font-semibold leading-none" style={{ color: c.color }}>
                {n}
              </span>
              <span className="text-xs text-muted-foreground">{n === 1 ? 'estado' : 'estados'}</span>
            </div>
            <div className="mt-1 text-xs leading-tight text-muted-foreground">{c.short}</div>
          </div>
        </div>
      ))}
      {rest > 0 && rest < 27 && <p className="col-span-2 -mt-1 text-[11px] text-muted-foreground">{rest} sem parcial ainda.</p>}
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="space-y-4 pt-1">
      <Skeleton className="h-12 w-3/4" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <Skeleton className="aspect-square w-full rounded-2xl" />
    </div>
  );
}
