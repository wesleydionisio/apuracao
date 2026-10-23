// Camadas de contexto do 2º turno: transferência de votos do 1º turno e "virou de lado" vs 2022.
import type { Board, HistoryFile, HistRow, MunBoard, Municipality, Snap } from '@apuracao/shared';
import { flipped, transfer, ufName } from '@apuracao/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { fetchMunBoard, staticData } from '../lib/api';
import { fmtCompact, fmtPct, signed } from '../lib/format';
import { candOf, shortLabel } from '../store/board';
import { Card, Chip, Empty, Skeleton, Title } from './ui';

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean } {
  const [s, set] = useState<{ data: T | undefined; loading: boolean }>({ data: undefined, loading: true });
  useEffect(() => {
    let alive = true;
    set({ data: undefined, loading: true });
    fn()
      .then((data) => alive && set({ data, loading: false }))
      .catch(() => alive && set({ data: undefined, loading: false }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

export { useAsync };

/** Barra de fluxo: estoque do 1º turno → quanto foi para A, para B e o resto. */
function FlowBar({ board, snap, t1 }: { board: Board; snap: Snap; t1: HistRow }) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const t = transfer(snap, t1, board.candidates);
  const ga = Math.max(0, t.gainA);
  const gb = Math.max(0, t.gainB);
  const rest = Math.max(0, t.stock - ga - gb);
  const tot = ga + gb + rest || 1;
  return (
    <div>
      <div className="flex h-7 w-full overflow-hidden rounded-lg text-[11px] font-semibold text-white">
        <div className="flex items-center justify-center" style={{ width: `${(ga / tot) * 100}%`, background: ca.color }}>
          {ga / tot > 0.12 ? fmtPct((ga / tot) * 100, 0) + '%' : ''}
        </div>
        <div className="flex items-center justify-center" style={{ width: `${(gb / tot) * 100}%`, background: cb.color }}>
          {gb / tot > 0.12 ? fmtPct((gb / tot) * 100, 0) + '%' : ''}
        </div>
        <div className="bg-soft" style={{ width: `${(rest / tot) * 100}%` }} />
      </div>
      <div className="num mt-2 grid grid-cols-2 gap-2 text-[12px]">
        <div>
          <span style={{ color: ca.color }} className="font-semibold">{ca.short}</span>: {signed(t.gainA / 1e6, 2)} mi
          {t.pctA !== null && <span className="text-muted"> ({fmtPct(t.pctA, 0)}% do estoque)</span>}
        </div>
        <div className="text-right">
          <span style={{ color: cb.color }} className="font-semibold">{cb.short}</span>: {signed(t.gainB / 1e6, 2)} mi
          {t.pctB !== null && <span className="text-muted"> ({fmtPct(t.pctB, 0)}%)</span>}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-muted">
        Parte cinza: quem não votou ou votou branco/nulo. Estoque ≈ {fmtCompact(t.stock)} votos (eliminados + brancos/nulos + abstenção do 1º turno)
        {t.scale < 1 ? `, proporcional aos ${fmtPct(t.scale * 100, 0)}% do eleitorado já apurado` : ''}.
      </p>
    </div>
  );
}

export function TransferCard({ board }: { board: Board }) {
  const { data: hist, loading } = useAsync(() => staticData.hist('t1-2026'), []);
  const br = board.br;
  const rows = useMemo(() => {
    if (!hist) return [];
    return Object.entries(board.ufs)
      .map(([k, s]) => {
        const h = hist.uf[k.slice(3)];
        return h && s.valid ? { uf: k.slice(3), t: transfer(s, h, board.candidates) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x && x.t.stock > 0)
      .sort((x, y) => y.t.stock - x.t.stock)
      .slice(0, 10);
  }, [hist, board.ufs, board.candidates]);
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  return (
    <Card>
      <Title right={<Chip>vs 1º turno</Chip>}>De onde vieram os votos</Title>
      {loading ? (
        <Skeleton h={90} />
      ) : !hist?.br || !br ? (
        <Empty title="Dados do 1º turno ainda não carregados">A comparação aparece assim que o histórico for publicado.</Empty>
      ) : (
        <>
          <FlowBar board={board} snap={br} t1={hist.br} />
          {rows.length > 0 && (
            <table className="num mt-4 w-full text-[12px]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-medium">UF</th>
                  <th className="py-1 text-right font-medium" style={{ color: ca.color }}>{shortLabel(board.candidates, 0)}</th>
                  <th className="py-1 text-right font-medium" style={{ color: cb.color }}>{shortLabel(board.candidates, 1)}</th>
                  <th className="py-1 text-right font-medium">estoque</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.uf}>
                    <td className="py-1.5">
                      <Link href={`/mapa/${r.uf}`} className="font-semibold">{r.uf}</Link>
                    </td>
                    <td className="py-1.5 text-right">{r.t.pctA === null ? '—' : `${fmtPct(r.t.pctA, 0)}%`}</td>
                    <td className="py-1.5 text-right">{r.t.pctB === null ? '—' : `${fmtPct(r.t.pctB, 0)}%`}</td>
                    <td className="py-1.5 text-right text-muted">{fmtCompact(r.t.stock)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Card>
  );
}

export function UfTransfer({ board, uf }: { board: Board; uf: string }) {
  const { data: hist } = useAsync(() => staticData.hist('t1-2026'), []);
  const s = board.ufs[`uf:${uf}`];
  const h = hist?.uf[uf];
  if (!s?.valid || !h) return null;
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-[13px] font-semibold">De onde vieram os votos em {ufName(uf)}</h3>
      <FlowBar board={board} snap={s} t1={h} />
    </div>
  );
}

/** Estados que mudaram de lado em relação a 2022 */
export function FlipsCard({ board }: { board: Board }) {
  const { data: y22, loading } = useAsync<HistoryFile | null>(() => staticData.hist('y2022-t2'), []);
  const list = useMemo(() => {
    if (!y22) return [];
    return Object.entries(board.ufs)
      .map(([k, s]) => ({ uf: k.slice(3), s, f: s.pst >= 5 ? flipped(s, y22.uf[k.slice(3)], board.y2022Map) : null }))
      .filter((x) => x.f)
      .sort((x, y) => (y.s.el || 0) - (x.s.el || 0));
  }, [y22, board.ufs, board.y2022Map]);
  return (
    <Card>
      <Title right={<Chip>vs 2º turno de 2022</Chip>}>Virou de lado</Title>
      {loading ? (
        <Skeleton h={80} />
      ) : !y22 ? (
        <Empty title="Histórico de 2022 ainda não carregado" />
      ) : !list.length ? (
        <Empty title="Nenhum estado mudou de lado até agora">Contamos só estados com pelo menos 5% apurado.</Empty>
      ) : (
        <ul className="space-y-2">
          {list.map(({ uf, s, f }) => {
            const to = candOf(board, f!.to)!;
            return (
              <li key={uf}>
                <Link href={`/mapa/${uf}`} className="flex min-h-11 items-center justify-between gap-2 rounded-xl bg-soft px-3 py-2">
                  <span className="text-[14px]">
                    <strong>{ufName(uf)}</strong> virou para <strong style={{ color: to.color }}>{to.short}</strong>
                  </span>
                  <span className="num shrink-0 text-[11px] text-muted">{fmtPct(s.pst, 0)}% apurado</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-muted">Parcial: pode desvirar até o fim da apuração. Toque num estado para ver as cidades.</p>
    </Card>
  );
}

export interface MunRow {
  m: Municipality;
  s: Snap | null;
  y22: HistRow | null;
  t1: HistRow | null;
}

/** Municípios de uma UF já coletados, com 1º turno e 2022. */
export function useUfMunicipalities(uf: string, released: boolean) {
  return useAsync(async () => {
    const [list, mb, y22, t1] = await Promise.all([
      staticData.municipalities(),
      released ? fetchMunBoard(uf) : Promise.resolve<MunBoard | null>(null),
      staticData.histMun('y2022-t2', uf).catch(() => null),
      staticData.histMun('t1-2026', uf).catch(() => null),
    ]);
    const rows: MunRow[] = (list ?? [])
      .filter((m) => m.uf === uf)
      .map((m) => ({ m, s: mb?.mun[m.ibge] ?? null, y22: y22?.[m.ibge] ?? null, t1: t1?.[m.ibge] ?? null }))
      .sort((a, b) => b.m.el - a.m.el);
    return { rows, hasLive: !!mb };
  }, [uf, released]);
}
