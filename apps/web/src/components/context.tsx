// Camadas de contexto do 2º turno: transferência de votos do 1º turno e "virou de lado" vs 2022.
import type { Board, CandidateDef, HistoryFile, HistRow, MunBoard, Municipality, Snap } from '@apuracao/shared';
import { flipped, transfer, twoWay, ufName } from '@apuracao/shared';
import { ArrowRight, Repeat2, Waypoints } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { TransferSankey } from '@/features/score/Sankey';
import { MetaPill, Section } from '@/features/score/Section';
import { cn } from '@/lib/utils';
import { fetchMunBoard, staticData } from '../lib/api';
import { fmtCompact, fmtPct, signed } from '../lib/format';
import { candOf } from '../store/board';
import { Empty, Skeleton } from './ui';

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
 * Fluxo do estoque do 1º turno (votos dos eliminados + brancos/nulos + abstenção) em barra:
 * quanto foi para A, para B e quanto ficou de fora. Usado nos painéis de UF.
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
      <div
        className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label={`${ca.short} ficou com ${fmtPct((ga / tot) * 100, 0)}% do estoque, ${cb.short} com ${fmtPct((gb / tot) * 100, 0)}%`}
      >
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
              <dd className="display text-[17px] leading-tight font-semibold" style={{ color: c.color }}>
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

/** parte do estoque: com dado parcial escalonado o ganho pode passar do estoque — não inventamos precisão */
const sharePct = (p: number | null) => (p === null ? '—' : p > 100 ? '>100%' : `${fmtPct(Math.max(0, p), 0)}%`);

export function TransferCard({ board, className }: { board: Board; className?: string }) {
  const { data: hist, loading } = useAsync(() => staticData.hist('t1-2026'), []);
  const br = board.br;
  const [ca, cb] = board.candidates;
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
  const t = hist?.br && br ? transfer(br, hist.br, board.candidates) : null;
  return (
    <Section icon={Waypoints} title="De onde vieram os votos" meta={<MetaPill>vs 1º turno</MetaPill>} className={className}>
      {loading ? (
        <Skeleton h={220} />
      ) : !t ? (
        <Empty title="Histórico do 1º turno indisponível">A comparação aparece assim que o histórico for publicado.</Empty>
      ) : (
        <>
          <p className="mb-3 text-[13px] leading-snug text-muted-foreground">
            Votos que ficaram livres depois do 1º turno (de quem foi eliminado, brancos, nulos e quem não votou) e para onde foram até
            agora.
          </p>
          <TransferSankey t={t} ca={ca} cb={cb} />
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Ganho de cada um sobre o próprio 1º turno
            {t.scale < 1 ? `, proporcional aos ${fmtPct(t.scale * 100, 0)}% do eleitorado já apurado` : ''}. Perdas contam como zero.
          </p>
          {rows.length > 0 && (
            <table className="num mt-4 w-full text-[12px]">
              <caption className="sr-only">Parte do estoque do 1º turno que foi para cada candidato, por estado</caption>
              <thead className="text-left text-[11px] text-muted-foreground">
                <tr className="border-b">
                  <th className="py-1.5 font-normal">Estado</th>
                  <th className="w-[36%] py-1.5 font-normal">
                    <span className="sr-only">Divisão do estoque</span>
                  </th>
                  <th className="py-1.5 text-right font-normal">{ca.short.split(' ')[0]}</th>
                  <th className="py-1.5 text-right font-normal">{cb.short.split(' ')[0]}</th>
                  <th className="py-1.5 text-right font-normal">Estoque</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const ga = Math.max(0, r.t.gainA);
                  const gb = Math.max(0, r.t.gainB);
                  const tot = Math.max(r.t.stock, ga + gb) || 1;
                  return (
                    <tr key={r.uf}>
                      <td className="py-2.5">
                        <Link href={`/mapa/${r.uf}`} className="font-semibold hover:underline">
                          {r.uf}
                        </Link>
                      </td>
                      <td className="py-2.5 pr-2">
                        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
                          <div style={{ width: `${(ga / tot) * 100}%`, background: ca.color }} />
                          <div style={{ width: `${(gb / tot) * 100}%`, background: cb.color }} />
                        </div>
                      </td>
                      <td className="py-2.5 text-right font-medium" style={{ color: ca.color }}>
                        {sharePct(r.t.pctA)}
                      </td>
                      <td className="py-2.5 text-right font-medium" style={{ color: cb.color }}>
                        {sharePct(r.t.pctB)}
                      </td>
                      <td className="py-2.5 text-right text-muted-foreground">{fmtCompact(r.t.stock)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </>
      )}
    </Section>
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

/** barrinha A×B (A à esquerda) com a marca dos 50% */
function Duel({ pa, ca, cb, faded = false }: { pa: number; ca: CandidateDef; cb: CandidateDef; faded?: boolean }) {
  return (
    <div className={cn('relative flex h-1.5 overflow-hidden rounded-full', faded && 'opacity-55')} aria-hidden>
      <div style={{ width: `${pa}%`, background: ca.color }} />
      <div className="flex-1" style={{ background: cb.color }} />
      <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-card" />
    </div>
  );
}

const FLIP_COLS = 'grid-cols-[minmax(0,1fr)_4.5rem_1rem_4.5rem]';

/** Estados que mudaram de lado em relação a 2022: barra de 2022 → barra de agora */
export function FlipsCard({ board, className }: { board: Board; className?: string }) {
  const { data: y22, loading } = useAsync<HistoryFile | null>(() => staticData.hist('y2022-t2'), []);
  const [ca, cb] = board.candidates;
  const c22 = useMemo(
    () => [
      { ...ca, n: board.y2022Map.a },
      { ...cb, n: board.y2022Map.b },
    ],
    [ca, cb, board.y2022Map],
  );
  const list = useMemo(() => {
    if (!y22) return [];
    return Object.entries(board.ufs)
      .map(([k, s]) => {
        const uf = k.slice(3);
        const f = s.pst >= 5 ? flipped(s, y22.uf[uf], board.y2022Map) : null;
        return { uf, s, f, pa22: twoWay(y22.uf[uf], c22) };
      })
      .filter((x) => x.f)
      .sort((x, y) => (y.s.el || 0) - (x.s.el || 0));
  }, [y22, board.ufs, board.y2022Map, c22]);
  const total = Object.keys(board.ufs).length;
  return (
    <Section
      icon={Repeat2}
      title="Virou de lado"
      meta={y22 && total > 0 ? <span className="num">{list.length} de {total} vs 2022</span> : <MetaPill>vs 2022</MetaPill>}
      className={className}
    >
      {loading ? (
        <Skeleton h={120} />
      ) : !y22 ? (
        <Empty title="Histórico de 2022 indisponível">A comparação aparece quando o arquivo de 2022 estiver publicado.</Empty>
      ) : !list.length ? (
        <Empty title="Nenhum estado mudou de lado até agora">Contamos só estados com pelo menos 5% apurado. Pode mudar a qualquer momento.</Empty>
      ) : (
        <>
          <div className={cn('grid items-center gap-2 border-b pb-1.5 text-[11px] text-muted-foreground', FLIP_COLS)} aria-hidden>
            <span>Estado</span>
            <span>2022</span>
            <span />
            <span>agora</span>
          </div>
          <ul className="divide-y">
            {list.map(({ uf, s, f, pa22 }) => {
              const to = candOf(board, f!.to)!;
              return (
                <li key={uf}>
                  <Link
                    href={`/mapa/${uf}`}
                    className={cn('press -mx-1 grid min-h-13 items-center gap-2 rounded-lg px-1 hover:bg-accent/60', FLIP_COLS)}
                    aria-label={`${ufName(uf)} virou para ${to.short}, com ${fmtPct(s.pst, 0)}% apurado`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <CandidateAvatar c={to} size="xs" />
                      <div className="min-w-0">
                        <div className="truncate text-[14px] font-semibold">{ufName(uf)}</div>
                        <div className="num text-[11px] text-muted-foreground">{fmtPct(s.pst, 0)}% apurado</div>
                      </div>
                    </div>
                    <div>
                      {pa22 !== null && <Duel pa={pa22} ca={ca} cb={cb} faded />}
                      <div className="num mt-1 text-[11px] text-muted-foreground">
                        {pa22 === null ? '—' : `${fmtPct(Math.max(pa22, 100 - pa22), 0)}%`}
                      </div>
                    </div>
                    <ArrowRight className="size-3.5 text-muted-foreground" aria-hidden />
                    <div>
                      <Duel pa={s.pa} ca={ca} cb={cb} />
                      <div className="num mt-1 text-[11px] font-semibold" style={{ color: to.color }}>
                        {fmtPct(Math.max(s.pa, s.pb), 1)}%
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <p className="mt-2 text-[11px] text-muted-foreground">Parcial: pode desvirar até o fim da apuração. 2022 pelo partido de cada lado.</p>
    </Section>
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
