// Páginas fora da moldura do app: momento, modo TV e embed.
import type { Board } from '@apuracao/shared';
import { Link, useParams } from 'wouter';
import { fmtCountdown, LegalFooter, SplitBar } from '../components/chrome';
import { momentShare, STATUS_LABEL } from '../components/placar';
import { Card, Empty, ShareButton, TseLink, useNow } from '../components/ui';
import { fmtCompact, fmtHM, fmtPct, fmtTime } from '../lib/format';
import { candOf, useBoard } from '../store/board';
import { Loading } from './Home';

export function MomentPage() {
  const board = useBoard((s) => s.board);
  const { id } = useParams<{ id: string }>();
  if (!board) return <Loading />;
  const m = board.moments.find((x) => x.id === decodeURIComponent(id ?? ''));
  if (!m)
    return (
      <div className="space-y-3">
        <Empty title="Momento não encontrado">Talvez ele ainda não tenha acontecido por aqui.</Empty>
        <Link href="/" className="flex min-h-12 items-center justify-center rounded-xl bg-fg font-semibold text-bg">Ver placar ao vivo</Link>
      </div>
    );
  return (
    <div className="space-y-3">
      <Card>
        <div className="num text-[12px] text-muted">{fmtHM(m.at)} · momento da apuração</div>
        <p className="mt-2 text-[22px] font-extrabold leading-tight">{m.title}</p>
      </Card>
      <ShareButton input={momentShare(m)} className="w-full" />
      <Link href="/" className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-card font-semibold">
        Acompanhar ao vivo
      </Link>
      <LegalFooter />
    </div>
  );
}

/** /tv — tela cheia para projetar. Sem chat, letras enormes, atualiza sozinho. */
export function TvPage() {
  const board = useBoard((s) => s.board);
  const now = useNow(1000);
  if (!board) return <div className="flex h-dvh items-center justify-center text-2xl text-muted">Carregando…</div>;
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const br = board.br;
  return (
    <div className="flex min-h-dvh flex-col justify-between gap-[3vh] bg-bg p-[4vw] text-fg">
      {!board.released || !br ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <div className="text-[3vw] text-muted">A apuração do 2º turno começa em</div>
          <div className="num text-[12vw] font-extrabold leading-none">{fmtCountdown(Date.parse(board.releaseAt) - now)}</div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between text-[2.2vw] text-muted">
            <span>{STATUS_LABEL[br.status]}</span>
            <span className="num">{fmtPct(br.pst)}% das urnas apuradas</span>
          </div>
          <div className="grid grid-cols-2 gap-[4vw]">
            {[
              [ca, br.pa, br.a],
              [cb, br.pb, br.b],
            ].map(([c, p, v], i) => {
              const cc = c as typeof ca;
              return (
                <div key={cc.key} className={i ? 'text-right' : ''}>
                  <div className="text-[3.4vw] font-bold" style={{ color: cc.color }}>{cc.short}</div>
                  <div className="num text-[13vw] font-extrabold leading-[0.9] tracking-tight">{fmtPct(p as number)}%</div>
                  <div className="num text-[2vw] text-muted">{fmtCompact(v as number)} votos</div>
                </div>
              );
            })}
          </div>
          <SplitBar b={board} h={36} />
          {br.status === 'apurando' && br.need !== null && br.lead && (
            <div className="text-center text-[2.6vw]">
              {candOf(board, br.lead === 'a' ? 'b' : 'a')!.short} precisa de{' '}
              <strong className="num">{br.need > 100 ? '+100' : fmtPct(br.need, 1)}%</strong> do que falta para virar
            </div>
          )}
          {board.moments[0] && <div className="truncate text-center text-[2.2vw] text-muted">{board.moments[0].title}</div>}
        </>
      )}
      <div className="flex items-center justify-between text-[1.6vw] text-muted">
        <span>
          Dados oficiais do TSE, atualizados às <span className="num">{fmtTime(board.source.at)}</span>
        </span>
        <span>{location.host}</span>
      </div>
    </div>
  );
}

/** /embed/placar — compacto para iframe em portais e lives (traz backlink). */
export function EmbedPage() {
  const board = useBoard((s) => s.board);
  if (!board) return <div className="p-3 text-sm text-muted">Carregando…</div>;
  return (
    <div className="p-3">
      <EmbedBody board={board} />
    </div>
  );
}

function EmbedBody({ board }: { board: Board }) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const br = board.br;
  const site = location.origin;
  return (
    <div className="surface rounded-2xl p-3">
      {!board.released || !br ? (
        <p className="text-[14px]">A apuração do 2º turno começa às 17h (Brasília).</p>
      ) : (
        <>
          <div className="flex items-end justify-between">
            <div>
              <div className="text-[12px] font-semibold" style={{ color: ca.color }}>{ca.short}</div>
              <div className="display text-[28px] font-extrabold leading-none">{fmtPct(br.pa)}%</div>
            </div>
            <div className="num text-center text-[12px] text-muted">{fmtPct(br.pst)}%<br />apurado</div>
            <div className="text-right">
              <div className="text-[12px] font-semibold" style={{ color: cb.color }}>{cb.short}</div>
              <div className="display text-[28px] font-extrabold leading-none">{fmtPct(br.pb)}%</div>
            </div>
          </div>
          <div className="mt-2">
            <SplitBar b={board} h={10} />
          </div>
        </>
      )}
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <TseLink />
        <a href={site} target="_blank" rel="noopener" className="font-semibold underline">
          ao vivo em {location.host}
        </a>
      </div>
    </div>
  );
}

