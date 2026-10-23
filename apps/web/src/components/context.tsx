// Camadas de contexto do 2º turno: transferência de votos do 1º turno e "virou de lado" vs 2022.
import type { Board, HistoryFile, HistRow, MunBoard, Municipality, Snap } from '@apuracao/shared';
import { flipped, transfer, ufName } from '@apuracao/shared';
import { ArrowRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { fetchMunBoard, staticData } from '../lib/api';
import { fmtCompact, fmtPct, signed } from '../lib/format';
import { candOf } from '../store/board';
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

/**
 * Fluxo do estoque do 1º turno (votos dos eliminados + brancos/nulos + abstenção):
 * quanto foi para A, para B e quanto ficou de fora.
 */
function FlowBar({ board, snap, t1 }: { board: Board; snap: Snap; t1: HistRow }) {
  const [ca, cb] = board.candidates;
  const t = transfer(snap, t1, board.candidates);
  const ga = Math.max(0, t.gainA);
  const gb = Math.max(0, t.gainB);
  const rest = Math.max(0, t.stock - ga - gb);
  const tot = ga + gb + rest || 1;
  const seg = [
    { k: 'a', w: ga / tot, color: ca.color },
    { k: 'b', w: gb / tot, color: cb.color },
    { k: 'r', w: rest / tot, color: 'var(--muted)' },
  ];
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-[11px] text-muted-foreground">
        <span>Estoque do 1º turno</span>
        <span className="num">≈ {fmtCompact(t.stock)} votos</span>
      </div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full" role="img" aria-label={`${ca.short} ficou com ${fmtPct((ga / tot) * 100, 0)}% do estoque, ${cb.short} com ${fmtPct((gb / tot) * 100, 0)}%`}>
        {seg.map((s) => (
          <div key={s.k} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${s.w * 100}%`, background: s.color }} />
        ))}
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3">
        {[
          { c: ca, gain: t.gainA, pct: t.pctA },
          { c: cb, gain: t.gainB, pct: t.pctB },
        ].map(({ c, gain, pct }) => (
          <div key={c.key} className="flex items-center gap-2.5">
            <CandidateAvatar c={c} size="sm" />
            <div className="min-w-0">
              <dt className="truncate text-[12px] text-muted-foreground">{c.short}</dt>
              <dd className="display text-[17px] font-semibold leading-tight" style={{ color: c.color }}>
                {pct === null ? '—' : `${fmtPct(pct, 0)}%`}
                <span className="num ml-1.5 text-[11px] font-normal text-muted-foreground">{signed(gain / 1e6, 2)} mi</span>
              </dd>
            </div>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
        Ganho de cada um sobre o 1º turno, como parte do estoque. Cinza: não votou ou votou branco/nulo
        {t.scale < 1 ? `. Proporcional aos ${fmtPct(t.scale * 100, 0)}% do eleitorado já apurado` : ''}.
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
      .slice(0, 8);
  }, [hist, board.ufs, board.candidates]);
  const [ca, cb] = board.candidates;
  return (
    <Card>
      <Title right={<Chip>vs 1º turno</Chip>}>De onde vieram os votos</Title>
      {loading ? (
        <Skeleton h={120} />
      ) : !hist?.br || !br ? (
        <Empty title="Histórico do 1º turno indisponível">A comparação aparece assim que o histórico for publicado.</Empty>
      ) : (
        <>
          <FlowBar board={board} snap={br} t1={hist.br} />
          {rows.length > 0 && (
            <table className="num mt-4 w-full text-[12px]">
              <caption className="sr-only">Parte do estoque do 1º turno que foi para cada candidato, por estado</caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 font-normal">Estado</th>
                  <th className="py-1.5 text-right font-normal">{ca.short.split(' ')[0]}</th>
                  <th className="py-1.5 text-right font-normal">{cb.short.split(' ')[0]}</th>
                  <th className="py-1.5 text-right font-normal">Estoque</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={r.uf}>
                    <td className="py-2">
                      <Link href={`/mapa/${r.uf}`} className="font-semibold hover:underline">
                        {r.uf}
                      </Link>
                    </td>
                    <td className="py-2 text-right font-medium" style={{ color: ca.color }}>{r.t.pctA === null ? '—' : `${fmtPct(r.t.pctA, 0)}%`}</td>
                    <td className="py-2 text-right font-medium" style={{ color: cb.color }}>{r.t.pctB === null ? '—' : `${fmtPct(r.t.pctB, 0)}%`}</td>
                    <td className="py-2 text-right text-muted-foreground">{fmtCompact(r.t.stock)}</td>
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
        <Skeleton h={90} />
      ) : !y22 ? (
        <Empty title="Histórico de 2022 indisponível" />
      ) : !list.length ? (
        <Empty title="Nenhum estado mudou de lado até agora">Contamos só estados com pelo menos 5% apurado.</Empty>
      ) : (
        <ul className="-mx-1 divide-y">
          {list.map(({ uf, s, f }) => {
            const from = candOf(board, f!.from)!;
            const to = candOf(board, f!.to)!;
            return (
              <li key={uf}>
                <Link href={`/mapa/${uf}`} className="press flex min-h-13 items-center gap-3 rounded-lg px-1 hover:bg-accent/60">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-semibold">{ufName(uf)}</div>
                    <div className="num text-[11px] text-muted-foreground">{fmtPct(s.pst, 0)}% apurado</div>
                  </div>
                  <span className="flex shrink-0 items-center gap-1.5" aria-label={`de ${from.party ?? from.short} em 2022 para ${to.short}`}>
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ color: from.color, background: `color-mix(in oklab, ${from.color} 12%, transparent)` }}>
                      {board.y2022Map[from.key] === from.n && from.party ? `${from.party} em 2022` : '2022'}
                    </span>
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                    <CandidateAvatar c={to} size="xs" />
                    <span className="text-[13px] font-semibold" style={{ color: to.color }}>
                      {to.short.split(' ')[0]}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Parcial: pode desvirar até o fim da apuração.</p>
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
