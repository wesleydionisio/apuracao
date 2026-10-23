import type { Board, Snap } from '@apuracao/shared';
import { flipped, slugify, transfer, twoWay, ufName } from '@apuracao/shared';
import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { CitySearch } from '../components/city-search';
import { LegalFooter } from '../components/chrome';
import { useAsync } from '../components/context';
import { StatusChip } from '../components/placar';
import { Card, Empty, ShareButton, Skeleton, Title } from '../components/ui';
import { api, HttpError, ogUrl, staticData, type CityView } from '../lib/api';
import { fmtCompact, fmtInt, fmtPct, signed } from '../lib/format';
import { candOf, useBoard } from '../store/board';
import { Loading } from './Home';

const LS_CITY = 'my-city';

export default function CityPage() {
  const board = useBoard((s) => s.board);
  const params = useParams<{ uf?: string; slug?: string }>();
  const [, nav] = useLocation();
  if (!board) return <Loading />;
  if (!params.uf || !params.slug) return <CityHome nav={nav} />;
  return <CityDetail board={board} uf={params.uf} slug={params.slug} nav={nav} />;
}

function CityHome({ nav }: { nav: (to: string) => void }) {
  const [last, setLast] = useState<string | null>(null);
  useEffect(() => {
    try {
      setLast(localStorage.getItem(LS_CITY));
    } catch {
      /* sem storage */
    }
  }, []);
  return (
    <div className="space-y-3">
      <Card>
        <Title>Sua cidade</Title>
        <p className="mb-3 text-[13px] text-muted">Veja a parcial da sua cidade e compare com o 1º turno, com 2022, com o estado e com o Brasil.</p>
        <CitySearch onPick={(m) => nav(`/cidade/${m.uf.toLowerCase()}/${m.slug || slugify(m.name)}`)} />
        {last && (
          <Link href={last} className="mt-3 flex min-h-11 items-center text-[14px] font-semibold underline">
            Voltar para {decodeURIComponent(last.split('/').pop() ?? '').replace(/-/g, ' ')}
          </Link>
        )}
      </Card>
      <LegalFooter />
    </div>
  );
}

function CityDetail({ board, uf, slug, nav }: { board: Board; uf: string; slug: string; nav: (to: string) => void }) {
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
          try {
            localStorage.setItem(LS_CITY, `/cidade/${uf.toLowerCase()}/${slug}`);
          } catch {
            /* sem storage */
          }
        })
        .catch((e) => alive && setErr(e instanceof HttpError && e.status === 404 ? '404' : 'net'));
    setView(null);
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [UF, slug, uf]);

  // y2022 de reserva pelo arquivo estático, caso a API não traga
  const { data: y22uf } = useAsync(() => staticData.histMun('y2022-t2', UF), [UF]);

  const search = (
    <Card>
      <CitySearch onPick={(m) => nav(`/cidade/${m.uf.toLowerCase()}/${m.slug || slugify(m.name)}`)} placeholder="Buscar outra cidade" compact />
    </Card>
  );

  if (err === '404')
    return (
      <div className="space-y-3">
        <Empty title="Cidade não encontrada">Confira o nome e tente buscar de novo.</Empty>
        {search}
      </div>
    );
  if (!view)
    return (
      <div className="space-y-3">
        <Skeleton h={260} />
        {err && <p className="text-center text-[13px] text-muted">Sem conexão. Tentando de novo…</p>}
      </div>
    );

  const { mun } = view;
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const now = board.released ? view.now : null;
  const pa1 = twoWay(view.t1, board.candidates);
  const y22 = view.y2022 ?? y22uf?.[mun.ibge] ?? null;
  const pa22 = y22 ? twoWay(y22, [{ ...ca, n: board.y2022Map.a }, { ...cb, n: board.y2022Map.b }]) : null;
  const flip = now && y22 ? flipped(now, y22, board.y2022Map) : null;
  const tr = now?.valid && view.t1 ? transfer(now, view.t1, board.candidates) : null;
  const shareText = now?.valid
    ? `${mun.name} (${mun.uf}) com ${fmtPct(now.pst, 0)}% apurado: ${ca.short} ${fmtPct(now.pa, 1)}% × ${fmtPct(now.pb, 1)}% ${cb.short}`
    : `Acompanhe a apuração em ${mun.name} (${mun.uf})`;

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-1 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-[22px] font-extrabold leading-tight">{mun.name}</h1>
            <p className="text-[12px] text-muted">
              {ufName(mun.uf)}, {fmtCompact(mun.el)} eleitores
            </p>
          </div>
          {now && <StatusChip s={now.status} />}
        </div>
        {flip && (
          <p className="mt-2 rounded-xl bg-soft p-3 text-[14px] font-semibold">
            🔄 {mun.name} virou: em 2022 deu {candOf(board, flip.from)!.short}, agora {candOf(board, flip.to)!.short} está à frente
          </p>
        )}
        {!board.released ? (
          <p className="mt-3 text-[13px] text-muted">A parcial da cidade aparece aqui a partir das 17h de domingo.</p>
        ) : !now?.valid ? (
          <p className="mt-3 text-[13px] text-muted">Ainda sem parcial do TSE para esta cidade. Atualizamos sozinhos.</p>
        ) : (
          <CityScore board={board} s={now} />
        )}
      </Card>

      <Card>
        <Title>Comparação</Title>
        <ul className="num space-y-2 text-[13px]">
          {now?.valid && <Row label={`${mun.name} agora`} pa={now.pa} board={board} strong />}
          {view.uf?.valid && board.released && <Row label={`${ufName(mun.uf)} agora`} pa={view.uf.pa} board={board} />}
          {view.br?.valid && board.released && <Row label="Brasil agora" pa={view.br.pa} board={board} />}
          <Row label={`${mun.name} no 1º turno (A×B)`} pa={pa1} board={board} />
          <Row label={`${mun.name} em 2022 (2º turno)`} pa={pa22} board={board} />
        </ul>
        {tr && (
          <p className="mt-3 text-[12px] text-muted">
            Em relação ao 1º turno, {ca.short} {signed(tr.gainA / 1000, 1)} mil e {cb.short} {signed(tr.gainB / 1000, 1)} mil votos
            {tr.scale < 1 ? ' (proporcional ao apurado)' : ''}.
          </p>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-2">
        <ShareButton
          input={{ title: `${mun.name} na apuração`, text: shareText, url: `/cidade/${mun.uf.toLowerCase()}/${mun.slug || slugify(mun.name)}`, image: ogUrl.city(mun.ibge), filename: `${mun.slug}.png` }}
          label="Compartilhar minha cidade"
          className="w-full"
        />
      </div>
      {search}
      <LegalFooter />
    </div>
  );
}

function CityScore({ board, s }: { board: Board; s: Snap }) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  return (
    <div className="mt-3">
      <div className="flex justify-between">
        {[
          [ca, s.pa, s.a],
          [cb, s.pb, s.b],
        ].map(([c, p, v], i) => {
          const cc = c as typeof ca;
          return (
            <div key={cc.key} className={i ? 'text-right' : ''}>
              <div className="text-[13px] font-semibold" style={{ color: cc.color }}>{cc.short}</div>
              <div className="display text-[34px] font-extrabold leading-none">{fmtPct(p as number, 1)}%</div>
              <div className="num text-[12px] text-muted">{fmtInt(v as number)} votos</div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-soft">
        <div style={{ width: `${s.pa}%`, background: ca.color }} />
        <div style={{ width: `${s.pb}%`, background: cb.color }} />
      </div>
      <p className="num mt-2 text-[12px] text-muted">{fmtPct(s.pst, 1)}% das urnas apuradas na cidade</p>
    </div>
  );
}

function Row({ label, pa, board, strong }: { label: string; pa: number | null; board: Board; strong?: boolean }) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  return (
    <li className={`rounded-xl p-2.5 ${strong ? 'bg-soft' : ''}`}>
      <div className="flex justify-between gap-2">
        <span className={`min-w-0 truncate ${strong ? 'font-semibold' : ''}`}>{label}</span>
        {pa === null ? (
          <span className="text-muted">—</span>
        ) : (
          <span className="shrink-0 font-semibold">
            <span style={{ color: ca.color }}>{fmtPct(pa, 1)}</span> × <span style={{ color: cb.color }}>{fmtPct(100 - pa, 1)}</span>
          </span>
        )}
      </div>
      {pa !== null && (
        <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-soft">
          <div style={{ width: `${pa}%`, background: ca.color }} />
          <div style={{ width: `${100 - pa}%`, background: cb.color }} />
        </div>
      )}
    </li>
  );
}
