import type { Board, CandidateDef, Moment, Snap } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import { Link } from 'wouter';
import { ogUrl } from '../lib/api';
import { fmtCompact, fmtHM, fmtInt, fmtPct } from '../lib/format';
import { candOf, shortLabel } from '../store/board';
import { SplitBar } from './chrome';
import { Card, Chip, Empty, Estimate, ShareButton, Title } from './ui';

export const STATUS_LABEL: Record<Snap['status'], string> = {
  nao_iniciada: 'Apuração não iniciada',
  apurando: 'Em apuração',
  definido: 'Matematicamente definido',
  totalizado: 'Totalização concluída pelo TSE',
};

export function StatusChip({ s }: { s: Snap['status'] }) {
  return <Chip tone={s === 'apurando' ? 'live' : s === 'definido' || s === 'totalizado' ? 'warn' : 'muted'}>{STATUS_LABEL[s]}</Chip>;
}

function CandCol({ c, pct, votes, lead, align }: { c: CandidateDef; pct: number; votes: number; lead: boolean; align: 'left' | 'right' }) {
  return (
    <div className={`min-w-0 flex-1 ${align === 'right' ? 'text-right' : ''}`}>
      <div className={`flex items-center gap-1.5 ${align === 'right' ? 'justify-end' : ''}`}>
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
        <span className="truncate text-[14px] font-semibold">{c.short}</span>
      </div>
      <div className="num mt-1 text-[40px] font-extrabold leading-none tracking-tight">
        {fmtPct(pct)}
        <span className="text-xl">%</span>
      </div>
      <div className="num mt-1 text-[13px] text-muted">{fmtInt(votes)} votos</div>
      {lead && <div className="mt-1 text-[11px] font-medium text-muted">à frente</div>}
    </div>
  );
}

export function ScoreCard({ board, snap, title }: { board: Board; snap: Snap; title?: string }) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const diff = Math.abs(snap.a - snap.b);
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold">{title ?? 'Presidente, Brasil'}</h2>
        <StatusChip s={snap.status} />
      </div>
      <div className="flex gap-3">
        <CandCol c={ca} pct={snap.pa} votes={snap.a} lead={snap.lead === 'a'} align="left" />
        <CandCol c={cb} pct={snap.pb} votes={snap.b} lead={snap.lead === 'b'} align="right" />
      </div>
      <div className="mt-3">
        <SplitBar b={{ ...board, br: snap }} h={14} />
      </div>
      <div className="num mt-3 grid grid-cols-3 gap-2 text-center text-[12px]">
        <Stat label="apurado" value={`${fmtPct(snap.pst)}%`} />
        <Stat label="diferença" value={fmtCompact(diff)} />
        <Stat label="brancos+nulos" value={fmtCompact(snap.blank + snap.nulls)} />
      </div>
      {snap.status === 'totalizado' && snap.lead && (
        <p className="mt-3 rounded-xl bg-soft p-3 text-[13px]">
          Totalização concluída pelo TSE: <strong>{(snap.lead === 'a' ? ca : cb).short}</strong> tem a maioria dos votos válidos.
        </p>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-soft px-2 py-2">
      <div className="text-[15px] font-bold">{value}</div>
      <div className="text-[10px] text-muted">{label}</div>
    </div>
  );
}

/** "Vira ou não vira": quanto do que falta o candidato atrás precisa ter. */
export function NeedBar({ board, snap }: { board: Board; snap: Snap }) {
  if (snap.status === 'nao_iniciada' || !snap.lead) return null;
  const trail = candOf(board, snap.lead === 'a' ? 'b' : 'a')!;
  const lead = candOf(board, snap.lead)!;
  const trailNow = snap.lead === 'a' ? snap.pb : snap.pa;
  if (snap.status === 'definido' || snap.status === 'totalizado') {
    return (
      <Card>
        <Title>Vira ou não vira?</Title>
        <p className="text-[14px]">
          {snap.status === 'definido' ? (
            <>
              <strong>Matematicamente definido.</strong> A vantagem de {lead.short} ({fmtCompact(Math.abs(snap.a - snap.b))}) é maior que
              todo o eleitorado que ainda falta apurar ({fmtCompact(snap.rmax)}). O resultado oficial é o da totalização do TSE.
            </>
          ) : (
            <>Apuração encerrada.</>
          )}
        </p>
      </Card>
    );
  }
  const need = snap.need;
  const out = need !== null && need > 100;
  const pos = Math.min(100, need ?? 50);
  return (
    <Card>
      <Title right={<span className="num text-[12px] text-muted">faltam ~{fmtCompact(snap.rem)} votos</span>}>Vira ou não vira?</Title>
      <p className="text-[15px] leading-snug">
        Para virar, <strong style={{ color: trail.color }}>{trail.short}</strong> precisa de{' '}
        <strong className="num text-[20px]">{need === null ? '—' : out ? '+100' : fmtPct(need, 1)}%</strong> dos votos válidos que faltam.
      </p>
      <div className="relative mt-4 h-9">
        <div className="absolute inset-x-0 top-3 h-3 rounded-full bg-soft" />
        <div className="absolute top-3 h-3 rounded-l-full" style={{ width: `${Math.min(100, trailNow)}%`, background: trail.color, opacity: 0.35 }} />
        <div className="absolute top-1 h-7 w-[3px] -translate-x-1/2 rounded bg-fg" style={{ left: `${pos}%` }} />
        <div className="absolute top-0 h-full w-px bg-line" style={{ left: '50%' }} />
      </div>
      <div className="num flex justify-between text-[11px] text-muted">
        <span>0%</span>
        <span>
          tem {fmtPct(trailNow, 1)}% até agora · precisa {need === null ? '—' : out ? 'mais de 100' : fmtPct(need, 1)}%
        </span>
        <span>100%</span>
      </div>
      <p className="mt-3 text-[12px] text-muted">
        {out
          ? 'Pela estimativa de votos restantes, não alcança mais. Só é impossível de fato quando a vantagem supera todo o eleitorado que falta.'
          : 'Estimativa a partir do comparecimento observado em cada estado. Quanto mais perto de 50%, mais aberta está a disputa.'}
      </p>
    </Card>
  );
}

export function ProjectionCard({ board }: { board: Board }) {
  const p = board.projection;
  if (!board.flags.projection || !p) return null;
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const lo = Math.max(0, Math.min(p.lo, 100));
  const hi = Math.max(0, Math.min(p.hi, 100));
  // eixo de 40% a 60% para o intervalo ficar visível no celular
  const x = (v: number) => `${Math.max(0, Math.min(100, ((v - 40) / 20) * 100))}%`;
  return (
    <Card>
      <Title right={<Estimate pst={p.basedOnPst} />}>Para onde vai</Title>
      <p className="text-[14px] leading-snug">
        Se o que falta seguir o padrão observado até aqui, {ca.short} termina entre{' '}
        <strong className="num">{fmtPct(lo, 1)}%</strong> e <strong className="num">{fmtPct(hi, 1)}%</strong> dos votos válidos
        ({cb.short}: {fmtPct(100 - hi, 1)}% a {fmtPct(100 - lo, 1)}%).
      </p>
      <div className="relative mt-4 h-8">
        <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-soft" />
        <div className="absolute top-2 h-4 rounded-full" style={{ left: x(lo), width: `calc(${x(hi)} - ${x(lo)})`, background: ca.color, opacity: 0.5 }} />
        <div className="absolute top-0 h-8 w-px bg-fg/50" style={{ left: '50%' }} />
      </div>
      <div className="num flex justify-between text-[11px] text-muted">
        <span>40%</span>
        <span>50%</span>
        <span>60%</span>
      </div>
      <p className="mt-2 text-[12px] text-muted">Não é resultado. Modelo simples, sem pesquisa; pode errar. Vale o TSE.</p>
    </Card>
  );
}

export function Remaining({ board, limit = 8 }: { board: Board; limit?: number }) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const rows = board.remaining.slice(0, limit);
  return (
    <Card>
      <Title right={<span className="text-[11px] text-muted">tendência no 1º turno</span>}>Onde ainda falta</Title>
      {!rows.length ? (
        <Empty title="Nada relevante a apurar">Todos os estados estão praticamente apurados.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const t1lead = r.pa1 === null ? null : r.pa1 >= 50 ? ca : cb;
            return (
              <li key={r.uf}>
                <Link href={`/mapa/${r.uf}`} className="flex min-h-12 items-center gap-3 py-2">
                  <span className="w-8 shrink-0 text-[13px] font-bold">{r.uf}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex justify-between text-[12px]">
                      <span className="truncate">{ufName(r.uf)}</span>
                      <span className="num text-muted">{fmtPct(r.pst, 0)}% apurado</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-soft">
                      <div className="h-full bg-fg/60" style={{ width: `${r.pst}%` }} />
                    </div>
                  </div>
                  <div className="w-20 shrink-0 text-right">
                    <div className="num text-[13px] font-semibold">{fmtCompact(r.rem)}</div>
                    {t1lead && r.pa1 !== null && (
                      <div className="num text-[11px]" style={{ color: t1lead.color }}>
                        {shortLabel(board.candidates, t1lead.key === 'a' ? 0 : 1)} {fmtPct(Math.max(r.pa1, 100 - r.pa1), 0)}%
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export function momentShare(m: Moment) {
  return { title: 'Apuração ao vivo', text: m.title, url: `/m/${encodeURIComponent(m.id)}`, image: ogUrl.moment(m.id), filename: 'momento.png' };
}

export function MomentsFeed({ board, limit = 6 }: { board: Board; limit?: number }) {
  const list = board.moments.slice(0, limit);
  return (
    <Card>
      <Title>Momentos da noite</Title>
      {!list.length ? (
        <Empty title="Ainda nada">Marcos da apuração e viradas aparecem aqui assim que acontecerem.</Empty>
      ) : (
        <ol className="space-y-2" aria-live="polite">
          {list.map((m) => (
            <li key={m.id} className="flex items-start gap-2 rounded-xl bg-soft p-3">
              <div className="min-w-0 flex-1">
                <div className="num text-[11px] text-muted">{fmtHM(m.at)}</div>
                <Link href={`/m/${encodeURIComponent(m.id)}`} className="text-[14px] leading-snug">
                  {m.title}
                </Link>
              </div>
              <ShareButton input={momentShare(m)} label="" variant="ghost" className="!min-h-11 !w-11 !px-0" />
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
