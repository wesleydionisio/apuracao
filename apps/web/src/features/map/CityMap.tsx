// Mapa por cidade da aba Mapa: a grade de hexágonos do site (HexMap) sobre os ~27 mil pontos de dots.json,
// com a legenda e o cartão da cidade tocada.
import type { CandidateDef } from '@apuracao/shared';
import { fmtPct } from '@apuracao/shared';
import { ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { getJSON, type CityView } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { useCityValues, useDots, type DotLayer, type DotsFile, type Values } from './citydata';
import HexMap from './HexMap';
import { HexGlyph, useHexShades } from './Legend';

export type { DotLayer };

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export default function CityMap({
  layer,
  cands,
  below,
  className,
}: {
  layer: DotLayer;
  cands: CandidateDef[];
  /** logo abaixo do mapa, antes da legenda (a linha do exterior) */
  below?: ReactNode;
  className?: string;
}) {
  const board = useBoard((s) => s.board);
  const { dots, failed } = useDots();
  const values = useCityValues(dots, layer, board);
  const [picked, setPicked] = useState<number | null>(null);
  const shadesCss = useHexShades(cands);

  const stats = useMemo(() => {
    if (!values || !dots) return null;
    let started = 0;
    let done = 0;
    for (let i = 0; i < dots.mun.length; i++) {
      if (values.pst[i] > 0) started++;
      if (values.pst[i] >= 100) done++;
    }
    return { started, done, total: dots.mun.length };
  }, [values, dots]);

  if (failed) return <p className="py-10 text-center text-sm text-muted-foreground">Não foi possível carregar o mapa.</p>;

  return (
    <div className={cn('w-full', className)}>
      <HexMap
        cands={cands}
        layer={layer}
        cityValues={values}
        highlight={picked !== null && dots ? dots.mun[picked] : null}
        onPick={(hit) => setPicked(hit?.city ?? null)}
        label={
          stats
            ? `Mapa do Brasil em hexágonos: ${stats.started} de ${stats.total} cidades com apuração iniciada, ${stats.done} completas. Toque para ver uma cidade; + e − aproximam e afastam.`
            : undefined
        }
      />
      {below}
      <Legend cands={cands} shades={shadesCss} layer={layer} stats={stats} />
      <PickedCity m={picked} dots={dots} values={values} cands={cands} onClose={() => setPicked(null)} />
    </div>
  );
}

/** os três tons de cada candidato, do mais vivo para fora */
export function HexLegend({ cands, shades, className }: { cands: CandidateDef[]; shades: { a: string[]; b: string[] }; className?: string }) {
  const [ca, cb] = cands;
  return (
    <div className={cn('flex items-center justify-center gap-3 text-[12px] text-muted-foreground', className)}>
      <span className="inline-flex items-center gap-1.5">
        <span className="flex gap-0.5">
          {shades.a.map((c) => (
            <HexGlyph key={c} color={c} />
          ))}
        </span>
        {ca.short}
      </span>
      <span className="inline-flex items-center gap-1.5">
        {cb.short}
        <span className="flex gap-0.5">
          {[...shades.b].reverse().map((c) => (
            <HexGlyph key={c} color={c} />
          ))}
        </span>
      </span>
    </div>
  );
}

function Legend({
  cands,
  shades,
  layer,
  stats,
}: {
  cands: CandidateDef[];
  shades: { a: string[]; b: string[] };
  layer: DotLayer;
  stats: { started: number; done: number; total: number } | null;
}) {
  const live = layer === 'live';
  const progress =
    live && stats
      ? `${stats.started.toLocaleString('pt-BR')} de ${stats.total.toLocaleString('pt-BR')} cidades com apuração iniciada, ${stats.done.toLocaleString('pt-BR')} completas.`
      : '';
  return (
    <div className="mt-3 space-y-2 text-center text-[12px] text-muted-foreground">
      <HexLegend cands={cands} shades={shades} />
      <p className="flex flex-wrap items-center justify-center gap-x-1.5 text-pretty">
        <span>Tom mais vivo, vantagem maior.</span>
        {live && (
          <span className="inline-flex items-center gap-1">
            O hexágono cresce
            <span className="inline-flex items-end gap-0.5">
              <HexGlyph color="currentColor" size={5} opacity={0.5} />
              <HexGlyph color="currentColor" size={8} opacity={0.7} />
              <HexGlyph color="currentColor" size={11} />
            </span>
            conforme a região é apurada.
          </span>
        )}
        {progress && <span>{progress}</span>}
      </p>
    </div>
  );
}

function PickedCity({
  m,
  dots,
  values,
  cands,
  onClose,
}: {
  m: number | null;
  dots: DotsFile | null;
  values: Values | null;
  cands: CandidateDef[];
  onClose: () => void;
}) {
  const [city, setCity] = useState<CityView | null>(null);
  const ibge = m !== null && dots ? dots.mun[m] : null;
  useEffect(() => {
    setCity(null);
    if (!ibge) return;
    let alive = true;
    getJSON<CityView>(`/api/city/${ibge}`)
      .then((c) => alive && setCity(c))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ibge]);
  const touch = useMemo(coarse, []);
  // sempre ocupa o mesmo espaço: escolher ou soltar uma cidade não empurra a página
  return (
    <div className="mt-3 h-[60px]">
      {m !== null && dots && values ? (
        <div className="flex h-full items-center justify-between gap-3 rounded-xl border bg-card px-3">
          <div className="min-w-0">
            <div className="truncate text-[14px] font-semibold">
              {city?.mun.name ?? '…'} <span className="font-normal text-muted-foreground">{dots.uf[m]}</span>
            </div>
            <div className="num text-[12px] text-muted-foreground">
              {fmtPct(values.pst[m], 1)}% apurado
              {!Number.isNaN(values.pa[m]) && (
                <>
                  {', '}
                  <span style={{ color: cands[0].color }}>{fmtPct(values.pa[m], 1)}</span>
                  {' × '}
                  <span style={{ color: cands[1].color }}>{fmtPct(100 - values.pa[m], 1)}</span>
                </>
              )}
            </div>
          </div>
          {city ? (
            <Link
              href={`/cidade/${city.mun.uf.toLowerCase()}/${city.mun.slug}`}
              className="press inline-flex min-h-11 shrink-0 items-center gap-0.5 rounded-lg px-2 text-[13px] font-medium"
            >
              Abrir <ChevronRight className="size-4" aria-hidden />
            </Link>
          ) : (
            <button type="button" onClick={onClose} className="min-h-11 shrink-0 px-2 text-[13px] text-muted-foreground">
              Fechar
            </button>
          )}
        </div>
      ) : (
        <p className="flex h-full items-center justify-center text-center text-[12px] text-pretty text-muted-foreground">
          {touch
            ? 'Toque numa cidade para ver o resultado. Use dois dedos ou o + para aproximar.'
            : `Clique numa cidade para ver o resultado. Role ${isMac ? 'ou use a pinça do trackpad ' : ''}sobre o mapa para aproximar.`}
        </p>
      )}
    </div>
  );
}
