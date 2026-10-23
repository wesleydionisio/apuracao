import type { Board } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'wouter';
import { LegalFooter } from '../components/chrome';
import { GuessForm, myGuessId } from '../components/guess';
import { Card, Chip, Empty, ShareButton, Skeleton } from '../components/ui';
import { api, HttpError, ogUrl, type GuessView } from '../lib/api';
import { downloadImage } from '../lib/share';
import { fmtInt, fmtPct } from '../lib/format';
import { candOf, useBoard } from '../store/board';
import { Loading } from './Home';

export function PalpitePage() {
  const board = useBoard((s) => s.board);
  if (!board) return <Loading />;
  const mine = myGuessId();
  return (
    <div className="space-y-3">
      {mine && (
        <Link href={`/p/${mine}`} className="flex min-h-12 items-center justify-center rounded-xl border border-line bg-card text-[14px] font-semibold">
          Ver meu palpite
        </Link>
      )}
      <GuessForm board={board} />
      <LegalFooter />
    </div>
  );
}

const topPct = (rank: number, total: number) => (total ? Math.max(0.1, (rank / total) * 100) : 100);

export default function GuessPage() {
  const board = useBoard((s) => s.board);
  const { id } = useParams<{ id: string }>();
  const [v, setV] = useState<GuessView | null>(null);
  const [nf, setNf] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .guess(id!)
        .then((x) => alive && setV(x))
        .catch((e) => alive && e instanceof HttpError && e.status === 404 && setNf(true));
    load();
    const t = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [id]);
  if (!board) return <Loading />;
  if (nf) return <Empty title="Palpite não encontrado">O link pode estar incompleto.</Empty>;
  if (!v) return <Skeleton h={300} />;
  return <GuessCard board={board} v={v} mine={myGuessId() === v.guess.id} />;
}

function GuessCard({ board, v, mine }: { board: Board; v: GuessView; mine: boolean }) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const g = v.guess;
  const live = board.released ? v.live : null;
  const top = live ? topPct(live.rank, live.total) : null;
  const url = `/p/${g.id}`;
  const shareText = v.final && live
    ? `Errei por ${fmtPct(live.dist, 1)} ponto${live.dist >= 2 ? 's' : ''} o 2º turno — top ${fmtPct(top!, top! < 10 ? 1 : 0)}% do Brasil. E você?`
    : `Meu palpite pro 2º turno: ${ca.short} ${fmtPct(g.pa, 1)}% × ${fmtPct(100 - g.pa, 1)}% ${cb.short}. Qual é o seu?`;
  return (
    <div className="space-y-3">
      <Card className="overflow-hidden !p-0">
        <div className="p-4">
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-muted">Palpite de</span>
            {v.final ? <Chip tone="warn">resultado final</Chip> : live ? <Chip tone="live">ao vivo</Chip> : <Chip>2º turno · 25/out</Chip>}
          </div>
          <div className="mt-0.5 truncate text-[20px] font-extrabold">{g.nick}</div>
          <div className="mt-4 flex justify-between">
            <div>
              <div className="text-[13px] font-semibold" style={{ color: ca.color }}>{ca.short}</div>
              <div className="display text-[44px] font-extrabold leading-none">{fmtPct(g.pa, 1)}%</div>
            </div>
            <div className="text-right">
              <div className="text-[13px] font-semibold" style={{ color: cb.color }}>{cb.short}</div>
              <div className="display text-[44px] font-extrabold leading-none">{fmtPct(100 - g.pa, 1)}%</div>
            </div>
          </div>
          <div className="mt-3 flex h-3 overflow-hidden rounded-full">
            <div style={{ width: `${g.pa}%`, background: ca.color }} />
            <div style={{ width: `${100 - g.pa}%`, background: cb.color }} />
          </div>
          {(g.uf || g.mun) && (
            <p className="num mt-3 text-[12px] text-muted">
              {g.uf && g.ufPa != null && `${ufName(g.uf)}: ${fmtPct(g.ufPa, 1)}% × ${fmtPct(100 - g.ufPa, 1)}%`}
              {g.uf && g.ufPa != null && g.mun && g.munPa != null && ' · '}
              {g.mun && g.munPa != null && `cidade: ${fmtPct(g.munPa, 1)}% × ${fmtPct(100 - g.munPa, 1)}%`}
            </p>
          )}
        </div>
        {live && (
          <div className="border-t border-line bg-soft p-4">
            {v.final ? (
              <p className="text-[16px] font-bold leading-snug">
                {live.dist < 0.05 ? 'Na mosca!' : `Errou por ${fmtPct(live.dist, 2)} ponto${live.dist >= 2 ? 's' : ''}`} — top {fmtPct(top!, top! < 10 ? 1 : 0)}% do Brasil
              </p>
            ) : (
              <>
                <div className="text-[12px] text-muted">Distância para o parcial agora ({fmtPct(board.br?.pst ?? 0, 0)}% apurado)</div>
                <div className="display text-[30px] font-extrabold leading-tight">{fmtPct(live.dist, 2)} pts</div>
              </>
            )}
            <div className="num mt-3 grid grid-cols-2 gap-2 text-center">
              <Rank label="no Brasil" rank={live.rank} total={live.total} />
              {live.ufRank != null && live.ufTotal ? (
                <Rank label={g.uf ? `em ${g.uf}` : 'no estado'} rank={live.ufRank} total={live.ufTotal} />
              ) : live.munRank != null && live.munTotal ? (
                <Rank label="na cidade" rank={live.munRank} total={live.munTotal} />
              ) : (
                <div className="rounded-xl bg-card p-2">
                  <div className="text-[18px] font-bold">{fmtPct(live.pa, 1)}%</div>
                  <div className="text-[10px] text-muted">{ca.short} agora</div>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
      <ShareButton
        input={{ title: 'Meu palpite', text: shareText, url, image: ogUrl.guess(g.id, 'story'), filename: 'palpite.png' }}
        label={v.final ? 'Compartilhar meu resultado' : 'Mandar no WhatsApp / Stories'}
        className="w-full"
      />
      <button onClick={() => downloadImage(ogUrl.guess(g.id, 'story'), 'palpite.png')} className="min-h-11 w-full rounded-xl border border-line bg-card text-[14px]">
        Baixar imagem para Stories
      </button>
      {!mine && (
        <Link href="/palpite" className="flex min-h-12 items-center justify-center rounded-xl bg-soft text-[15px] font-semibold">
          Fazer o meu palpite
        </Link>
      )}
      {!live && board.released && <p className="text-center text-[13px] text-muted">O ranking aparece em instantes.</p>}
      <LegalFooter />
    </div>
  );
}

function Rank({ label, rank, total }: { label: string; rank: number; total: number }) {
  return (
    <div className="rounded-xl bg-card p-2">
      <div className="text-[18px] font-bold">
        {fmtInt(rank)}º <span className="text-[12px] font-medium text-muted">de {fmtInt(total)}</span>
      </div>
      <div className="text-[10px] text-muted">
        {label}, top {fmtPct(topPct(rank, total), topPct(rank, total) < 10 ? 1 : 0)}%
      </div>
    </div>
  );
}
