import type { Board, HistRow } from '@apuracao/shared';
import { flipped, slugify, twoWay, ufName } from '@apuracao/shared';
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { LegalFooter } from '../components/chrome';
import { UfTransfer, useAsync, useUfMunicipalities } from '../components/context';
import { ScoreCard } from '../components/placar';
import { Card, Chip, Empty, Skeleton, Title } from '../components/ui';
import { staticData } from '../lib/api';
import { fmtCompact, fmtPct } from '../lib/format';
import { MunCanvas, StatesSvg } from '../map/GeoMap';
import TileMap, { MapLegend } from '../map/TileMap';
import { candOf, shortLabel, useBoard } from '../store/board';
import { Loading } from './Home';

export default function MapPage() {
  const board = useBoard((s) => s.board);
  const params = useParams<{ uf?: string }>();
  const [, nav] = useLocation();
  const [mode, setMode] = useState<'grid' | 'geo'>('grid');
  const { data: t1 } = useAsync(() => staticData.hist('t1-2026'), []);
  const selected = params.uf?.toUpperCase() ?? null;

  const live = !!board?.released && !!board.br;
  const values = useMemo(() => {
    const out: Record<string, { pa: number | null; pst: number | null }> = {};
    if (!board) return out;
    if (live) {
      for (const [k, s] of Object.entries(board.ufs)) out[k.slice(3)] = { pa: s.valid ? s.pa : null, pst: s.pst };
    } else if (t1) {
      for (const [uf, h] of Object.entries(t1.uf)) out[uf] = { pa: twoWay(h, board.candidates), pst: null };
    }
    return out;
  }, [board, live, t1]);

  if (!board) return <Loading />;
  const pick = (uf: string) => nav(selected === uf ? '/mapa' : `/mapa/${uf}`, { replace: true });

  return (
    <div className="space-y-3">
      <Card>
        <Title
          right={
            <div className="flex rounded-lg bg-soft p-0.5 text-[12px]" role="tablist">
              {(['grid', 'geo'] as const).map((m) => (
                <button
                  key={m}
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`min-h-9 rounded-md px-3 ${mode === m ? 'bg-card font-semibold shadow-sm' : 'text-muted'}`}
                >
                  {m === 'grid' ? 'Grade' : 'Mapa'}
                </button>
              ))}
            </div>
          }
        >
          {live ? 'Por estado, agora' : 'Por estado no 1º turno'}
        </Title>
        {!live && <p className="mb-3 text-[12px] text-muted">Confronto direto entre os dois finalistas no 1º turno. O mapa ao vivo abre às 17h.</p>}
        {mode === 'grid' ? (
          <TileMap values={values} cands={board.candidates} selected={selected} onPick={pick} />
        ) : (
          <StatesSvg
            values={Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v.pa]))}
            cands={board.candidates}
            selected={selected}
            onPick={pick}
          />
        )}
        <MapLegend cands={board.candidates} />
        {!selected && <p className="mt-2 text-center text-[12px] text-muted">Toque num estado para ver as cidades</p>}
      </Card>
      {selected && <UfPanel key={selected} board={board} uf={selected} t1={t1?.uf[selected]} live={live} />}
      <LegalFooter />
    </div>
  );
}

function UfPanel({ board, uf, t1, live }: { board: Board; uf: string; t1?: HistRow; live: boolean }) {
  const snap = board.ufs[`uf:${uf}`];
  const { data: y22file } = useAsync(() => staticData.hist('y2022-t2'), []);
  const { data, loading } = useUfMunicipalities(uf, live);
  const [all, setAll] = useState(false);
  const [, nav] = useLocation();
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const y22 = y22file?.uf[uf];
  const flip = snap && y22 ? flipped(snap, y22, board.y2022Map) : null;
  const pa1 = twoWay(t1, board.candidates);
  const pa22 = y22 ? twoWay(y22, [{ ...ca, n: board.y2022Map.a }, { ...cb, n: board.y2022Map.b }]) : null;

  const munValues = useMemo(() => {
    const out: Record<string, number | null> = {};
    for (const r of data?.rows ?? []) out[r.m.ibge] = r.s?.valid ? r.s.pa : null;
    return out;
  }, [data]);

  const rows = (data?.rows ?? []).filter((r) => (live ? r.s : r.t1));
  const shown = all ? rows.slice(0, 120) : rows.slice(0, 12);

  return (
    <div className="space-y-3" id="uf-panel">
      {live && snap ? (
        <ScoreCard board={board} snap={snap} title={ufName(uf)} />
      ) : (
        <Card>
          <Title>{ufName(uf)}</Title>
          <p className="text-[13px] text-muted">A parcial de {uf} aparece aqui a partir das 17h.</p>
        </Card>
      )}
      <Card>
        <Title>{ufName(uf)} em contexto</Title>
        <div className="num grid grid-cols-2 gap-2 text-[13px]">
          <Compare label="1º turno 2026 (A×B)" pa={pa1} board={board} />
          <Compare label="2º turno 2022" pa={pa22} board={board} />
        </div>
        {flip && (
          <p className="mt-3 rounded-xl bg-soft p-3 text-[14px]">
            🔄 <strong>{ufName(uf)} virou</strong> em relação a 2022: agora {candOf(board, flip.to)!.short} está à frente
            {snap ? ` (${fmtPct(snap.pst, 0)}% apurado)` : ''}.
          </p>
        )}
        {live && <UfTransfer board={board} uf={uf} />}
      </Card>
      {live && board.flags.map_mun && (
        <Card>
          <Title right={<Chip>maiores cidades</Chip>}>Municípios de {uf}</Title>
          <MunCanvas
            uf={uf}
            values={munValues}
            cands={board.candidates}
            onPick={(ibge) => {
              const m = data?.rows.find((r) => r.m.ibge === ibge)?.m;
              if (m) nav(`/cidade/${m.uf.toLowerCase()}/${m.slug || slugify(m.name)}`);
            }}
          />
          <p className="mt-2 text-center text-[11px] text-muted">Cidades em cinza ainda não têm parcial coletada.</p>
        </Card>
      )}
      <Card>
        <Title>{live ? 'Cidades com parcial' : 'Cidades no 1º turno'}</Title>
        {loading ? (
          <Skeleton h={160} />
        ) : !rows.length ? (
          <Empty title="Sem dados de cidades ainda">{live ? 'As maiores cidades entram conforme o TSE publica.' : 'Histórico municipal ainda não carregado.'}</Empty>
        ) : (
          <>
            <ul className="divide-y divide-line">
              {shown.map((r) => {
                const pa = live ? (r.s?.valid ? r.s.pa : null) : twoWay(r.t1, board.candidates);
                const f = live && r.s && r.y22 ? flipped(r.s, r.y22, board.y2022Map) : null;
                const lead = pa === null ? null : pa >= 50 ? ca : cb;
                return (
                  <li key={r.m.ibge}>
                    <Link href={`/cidade/${r.m.uf.toLowerCase()}/${r.m.slug || slugify(r.m.name)}`} className="flex min-h-12 items-center gap-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[14px] font-medium">
                          {r.m.name} {f && <span title="virou vs 2022">🔄</span>}
                        </div>
                        <div className="num text-[11px] text-muted">
                          {fmtCompact(r.m.el)} eleitores{live && r.s ? ` · ${fmtPct(r.s.pst, 0)}% apurado` : ''}
                        </div>
                      </div>
                      {lead && pa !== null && (
                        <span className="num shrink-0 rounded-lg px-2 py-1 text-[12px] font-bold text-white" style={{ background: lead.color }}>
                          {shortLabel(board.candidates, lead.key === 'a' ? 0 : 1)} {fmtPct(Math.max(pa, 100 - pa), 1)}%
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
            {rows.length > 12 && !all && (
              <button onClick={() => setAll(true)} className="mt-2 min-h-11 w-full rounded-xl border border-line text-[14px]">
                Ver mais cidades ({rows.length})
              </button>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Compare({ label, pa, board }: { label: string; pa: number | null; board: Board }) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  return (
    <div className="rounded-xl bg-soft p-3">
      <div className="text-[11px] text-muted">{label}</div>
      {pa === null ? (
        <div className="mt-1 text-muted">—</div>
      ) : (
        <div className="mt-1 flex justify-between font-semibold">
          <span style={{ color: ca.color }}>{fmtPct(pa, 1)}%</span>
          <span style={{ color: cb.color }}>{fmtPct(100 - pa, 1)}%</span>
        </div>
      )}
    </div>
  );
}
