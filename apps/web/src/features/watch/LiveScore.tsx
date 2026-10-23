// Placar da tela Ao vivo: versus lado a lado, barra com a linha dos 50% e marcadores de referência
// (1º turno 2026, 2º turno 2022), chips para ligar/desligar as referências e o mini gráfico.
import type { Board, CandidateDef, Snap } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { ChartSpline, ChevronRight, Info } from 'lucide-react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fmtCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { flipOf, useCurve22, useHistRefs, type HistRefs } from './data';

import { NightSpark } from './NightSpark';
import { useRefs, type Refs } from './refs';
import { SplitFill } from '@/components/core/bars';

const PCT2 = { minimumFractionDigits: 2, maximumFractionDigits: 2 } as const;
const PCT1 = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;
const fmt1 = (v: number) => v.toLocaleString('pt-BR', PCT1);

const STATUS: Partial<Record<Snap['status'], string>> = {
  nao_iniciada: 'Aguardando as primeiras urnas',
  definido: 'Matematicamente definido',
  totalizado: 'Totalizado pelo TSE',
};

function Side({
  c,
  snap,
  pct,
  lead,
  align,
  size,
}: {
  c: CandidateDef;
  snap: Snap | null;
  pct: number | null;
  lead: boolean;
  align: 'l' | 'r';
  size: 'md' | 'lg';
}) {
  const votes = snap ? (c.key === 'a' ? snap.a : snap.b) : null;
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col', align === 'r' && 'items-end text-right')}>
      <div className={cn('flex max-w-full items-center gap-2.5', align === 'r' && 'flex-row-reverse')}>
        <CandidateAvatar c={c} size={size === 'lg' ? 'xl' : 'md'} ring={lead} priority />
        <div className="min-w-0">
          <div className="truncate text-[14px] leading-tight font-semibold tracking-[-0.01em]">{c.short}</div>
          <div className="num mt-0.5 truncate text-[11.5px] text-muted-foreground">
            {c.party}
            {votes !== null && votes > 0 && <> · {fmtCompact(votes)}</>}
          </div>
          {lead && size === 'lg' && (
            <div className="mt-0.5 text-[11px] font-semibold" style={{ color: `color-mix(in oklab, ${c.color} 80%, var(--foreground))` }}>
              à frente
            </div>
          )}
        </div>
      </div>
      <div
        className={cn(
          'display leading-none font-semibold',
          size === 'lg' ? 'mt-3 text-[56px]' : 'mt-1.5 text-[36px] min-[400px]:text-[40px]',
          !lead && pct !== null && 'text-foreground/55',
        )}
      >
        {pct === null ? '—' : <NumberFlow value={pct} format={PCT2} locales="pt-BR" suffix="%" willChange />}
      </div>
    </div>
  );
}

/** Referências ligadas: uma linha por eleição, A à esquerda e B à direita (alinhadas com o placar). */
function RefTable({ rows }: { rows: { label: string; pa: number }[] }) {
  if (!rows.length) return null;
  return (
    <dl className="mt-2 space-y-0.5 text-[12px]">
      {rows.map((r) => (
        <div key={r.label} className="num flex items-center justify-between gap-2 leading-5">
          <dd className="font-semibold text-foreground/85">{fmt1(r.pa)}%</dd>
          <dt className="flex items-center gap-1.5 truncate text-[11.5px] text-muted-foreground">
            <span className="h-2.5 w-[2px] rounded-full bg-foreground/70" aria-hidden />
            {r.label}
          </dt>
          <dd className="font-semibold text-foreground/85">{fmt1(100 - r.pa)}%</dd>
        </div>
      ))}
    </dl>
  );
}

/** Barra A×B: linha dos 50% e tiques de referência com rótulo curto */
export function VersusBar({
  board,
  pa,
  marks,
  className,
}: {
  board: Board;
  pa: number | null;
  marks: { v: number; label: string }[];
  className?: string;
}) {
  const [ca, cb] = board.candidates;
  const w = pa === null ? 50 : Math.max(0, Math.min(100, pa));
  // rótulos muito próximos viram um só, no meio dos dois tiques
  const labels =
    marks.length === 2 && Math.abs(marks[0].v - marks[1].v) < 8
      ? [{ v: (marks[0].v + marks[1].v) / 2, label: `${marks[0].label} · ${marks[1].label}` }]
      : marks;
  return (
    <div className={cn('relative', marks.length ? 'pt-3.5' : '', className)}>
      {labels.map((m) => (
        <span
          key={m.label}
          className="num absolute top-0 -translate-x-1/2 text-[11px] leading-none font-semibold whitespace-nowrap text-muted-foreground"
          style={{ left: `${Math.max(6, Math.min(94, m.v))}%` }}
        >
          {m.label}
        </span>
      ))}
      <div
        className="relative flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={pa === null ? 'Apuração não iniciada' : `${ca.short} ${fmt1(w)}%, ${cb.short} ${fmt1(100 - w)}%`}
      >
        {pa !== null && (
          <>
            <SplitFill pa={w} colorA={ca.color} colorB={cb.color} gap={2} />
          </>
        )}
        <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-background" aria-hidden />
      </div>
      {marks.map((m) => (
        <span
          key={`t-${m.label}`}
          className="absolute bottom-[-3px] h-[18px] w-[2px] -translate-x-1/2 rounded-full bg-foreground ring-2 ring-background"
          style={{ left: `${Math.max(0, Math.min(100, m.v))}%` }}
          aria-hidden
        />
      ))}
    </div>
  );
}

function RefChips({ refs, set, hist, showChart }: { refs: Refs; set: (p: Partial<Refs>) => void; hist: HistRefs; showChart: boolean }) {
  const value = [refs.t1 && 't1', refs.y22 && 'y22', showChart && refs.chart && 'chart'].filter(Boolean) as string[];
  const item =
    // 32px visíveis + alvo de toque de 44px (pseudo-elemento), sem engordar o placar
    'relative h-8 rounded-full border border-border bg-transparent px-3 before:absolute before:-inset-y-1.5 before:inset-x-0 text-[12px] font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-foreground data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:text-background';
  return (
    <ToggleGroup
      type="multiple"
      spacing={1.5}
      value={value}
      onValueChange={(v) => set({ t1: v.includes('t1'), y22: v.includes('y22'), ...(showChart ? { chart: v.includes('chart') } : {}) })}
      aria-label="Mostrar referências"
    >
      <ToggleGroupItem value="t1" className={item} aria-label="Mostrar 1º turno 2026">
        1º turno
      </ToggleGroupItem>
      <ToggleGroupItem value="y22" className={item} aria-label="Mostrar 2º turno de 2022, mesmos partidos">
        2022
      </ToggleGroupItem>
      {showChart && (
        <ToggleGroupItem value="chart" className={item} aria-label="Mostrar gráfico da noite">
          <ChartSpline className="size-3.5" aria-hidden />
          Gráfico
        </ToggleGroupItem>
      )}
    </ToggleGroup>
  );
}

/**
 * Placar completo da tela Ao vivo.
 * `size="lg"` no desktop (coluna da esquerda); `chartAlways` deixa o gráfico sempre aberto.
 */
export function LiveScore({
  board,
  size = 'md',
  chartAlways = false,
  onInfo,
}: {
  board: Board;
  size?: 'md' | 'lg';
  chartAlways?: boolean;
  onInfo?: () => void;
}) {
  const [refs, setRefs] = useRefs();
  const hist = useHistRefs(board);
  const showChart = chartAlways || refs.chart;
  // a curva vem sempre que o gráfico abre: a virada de 2022 marca a zona de atenção mesmo sem o chip 2022
  const curve22 = useCurve22(board, showChart);
  const flip22 = flipOf(curve22);
  const s = board.br;
  const [ca, cb] = board.candidates;
  const pa = s && s.valid ? s.pa : null;
  const marks: { v: number; label: string }[] = [];
  if (refs.t1 && hist.t1 !== null) marks.push({ v: hist.t1, label: '1º t.' });
  if (refs.y22 && hist.y22 !== null) marks.push({ v: hist.y22, label: '2022' });
  const status = s ? STATUS[s.status] : null;
  return (
    <section aria-label="Placar ao vivo" className={cn(size === 'lg' ? 'p-0' : 'px-4 pt-3 pb-2.5')}>
      <div className="flex items-start justify-between gap-4">
        <Side c={ca} snap={s} pct={pa} lead={s?.lead === 'a'} align="l" size={size} />
        <Side c={cb} snap={s} pct={pa === null ? null : s!.pb} lead={s?.lead === 'b'} align="r" size={size} />
      </div>
      <VersusBar board={board} pa={pa} marks={marks} className={size === 'lg' ? 'mt-5' : 'mt-2.5'} />
      <RefTable
        rows={[
          ...(refs.t1 && hist.t1 !== null ? [{ label: '1º turno 2026', pa: hist.t1 }] : []),
          ...(refs.y22 && hist.y22 !== null ? [{ label: '2º turno 2022 · mesmos partidos', pa: hist.y22 }] : []),
        ]}
      />
      <div className="mt-2 flex items-center justify-between gap-2 text-[11.5px] text-muted-foreground">
        <span className="num min-w-0 truncate">
          <span className="font-semibold text-foreground">{s ? s.pst.toLocaleString('pt-BR', PCT2) : '0,00'}%</span> das urnas
          {status && (
            <>
              {' · '}
              <span className={cn('font-semibold', s?.status === 'nao_iniciada' ? 'text-muted-foreground' : 'text-foreground')}>{status}</span>
            </>
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <SourceStamp at={board.source.at} short className="text-[11.5px]" />
          {onInfo && (
            <button type="button" onClick={onInfo} className="relative -mr-1.5 flex size-8 items-center justify-center rounded-full before:absolute before:-inset-1.5 hover:bg-accent" aria-label="Sobre os dados e o projeto">
              <Info className="size-3.5" aria-hidden />
            </button>
          )}
        </span>
      </div>
      <div className={cn('flex items-center justify-between gap-2', size === 'lg' ? 'mt-4' : 'mt-2')}>
        <RefChips refs={refs} set={setRefs} hist={hist} showChart={!chartAlways} />
        <Link
          href="/painel"
          className="relative inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full pr-1 pl-2 before:absolute before:-inset-y-1.5 before:inset-x-0 text-[12px] font-medium text-muted-foreground hover:text-foreground"
        >
          Painel
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      </div>
      {showChart && (
        <div className={cn('animate-in fade-in-0 duration-200', size === 'lg' ? 'mt-4' : 'mt-2')}>
          <NightSpark board={board} curve22={refs.y22 ? curve22 : null} t1={refs.t1 ? hist.t1 : null} flip22={flip22} height={size === 'lg' ? 220 : 104} />
          {refs.y22 && curve22 && (
            <p className="mt-1 text-[12px] text-muted-foreground">Curva tracejada: 2022 no mesmo ponto da apuração · reconstrução aproximada</p>
          )}
        </div>
      )}
    </section>
  );
}

/** Versão de uma linha (teclado aberto): avatares, % e barra. */
export function LiveScoreCompact({ board }: { board: Board }) {
  const s = board.br;
  const [ca, cb] = board.candidates;
  const pa = s && s.valid ? s.pa : null;
  return (
    <div className="flex items-center gap-2 px-3 py-2" aria-label="Placar">
      <CandidateAvatar c={ca} size="xs" ring={s?.lead === 'a'} />
      <span className="display min-w-[3.4rem] text-[16px] font-semibold">{pa === null ? '—' : <NumberFlow value={pa} format={PCT1} locales="pt-BR" suffix="%" />}</span>
      <div className="relative flex h-2 flex-1 gap-[2px] overflow-hidden rounded-full bg-muted">
        {pa !== null && (
          <>
            <SplitFill pa={pa} colorA={ca.color} colorB={cb.color} gap={2} />
          </>
        )}
        <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-background" />
      </div>
      <span className="display min-w-[3.4rem] text-right text-[16px] font-semibold">{pa === null ? '—' : <NumberFlow value={100 - pa} format={PCT1} locales="pt-BR" suffix="%" />}</span>
      <CandidateAvatar c={cb} size="xs" ring={s?.lead === 'b'} />
      <span className="num ml-1 text-[11px] text-muted-foreground">{s ? `${fmt1(s.pst)}%` : ''}</span>
    </div>
  );
}
