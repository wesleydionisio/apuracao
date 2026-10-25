// Placar da tela Ao vivo: versus lado a lado, barra com a linha dos 50% e marcadores de referência
// (1º turno 2026, 2º turno 2022), chips para ligar/desligar as referências e o mini gráfico.
import type { Board, CandidateDef, Snap } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { ChartSpline, ChevronRight, Info, X } from 'lucide-react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { SourceStamp } from '@/components/core/live';
import { VersusGlow } from '@/components/core/versus';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { fmtCompact } from '@/lib/format';
import { useNow } from '@/components/ui';
import { fmtCountdown } from '@/components/shell/bits';
import { cn } from '@/lib/utils';
import { flipOf, useCurve22, useHistRefs, type HistRefs } from './data';

import { NightSpark } from './NightSpark';
import { Swatch } from '@/features/curve/Swatch';
import { useRefs, type Refs } from './refs';
import { Fill, SplitFill } from '@/components/core/bars';
import { DataTip, SplitTip } from '@/components/core/datatip';
import { matchup2022 } from '@/lib/y2022';

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
/**
 * Referências numa linha de altura fixa: ligar ou desligar 1º turno/2022 troca só o conteúdo,
 * nunca empurra o que vem abaixo.
 */
function RefLine({ t1, y22, who22 }: { t1: number | null; y22: number | null; who22: string }) {
  const cell = (label: string, title: string, pa: number | null, align: 'l' | 'r') => (
    <div className={cn('flex min-w-0 items-center gap-1.5', align === 'r' && 'justify-end')} title={title}>
      {pa !== null && (
        <>
          <span className="h-2.5 w-[2px] shrink-0 rounded-full bg-foreground/70" aria-hidden />
          <span className="truncate text-muted-foreground">{label}</span>
          <span className="num font-semibold whitespace-nowrap text-foreground/85">
            {fmt1(pa)} × {fmt1(100 - pa)}
          </span>
        </>
      )}
    </div>
  );
  return (
    <div className="mt-1.5 grid h-5 grid-cols-2 items-center gap-3 text-[12px]" aria-live="polite">
      {t1 === null && y22 === null ? (
        <span className="col-span-2 truncate text-[11px] text-muted-foreground">Compare com o 1º turno ou com 2022</span>
      ) : (
        <>
          {cell('1º turno', '1º turno de 2026, só os dois finalistas', t1, 'l')}
          {cell('2022', `2º turno de 2022: ${who22}`, y22, 'r')}
        </>
      )}
    </div>
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
    <div className={cn('relative pt-3.5', className)}>
      {labels.map((m) => (
        <span
          key={m.label}
          className="num absolute top-0 -translate-x-1/2 text-[11px] leading-none font-semibold whitespace-nowrap text-muted-foreground"
          style={{ left: `${Math.max(6, Math.min(94, m.v))}%` }}
        >
          {m.label}
        </span>
      ))}
      <DataTip
        label={pa === null ? 'Apuração não iniciada' : `${ca.short} ${fmt1(w)}%, ${cb.short} ${fmt1(100 - w)}%`}
        tip={<SplitTip cands={board.candidates} pa={pa} extra={marks.length ? marks.map((m) => `${m.label}: ${fmt1(m.v)}%`).join(' · ') : undefined} />}
      >
        <div className="relative flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-muted" aria-hidden>
          {pa !== null && <SplitFill pa={w} colorA={ca.color} colorB={cb.color} gap={2} />}
          <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-background" />
        </div>
      </DataTip>
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

export function RefChips({
  refs,
  set,
  hist,
  showChart,
  board,
  only,
  className,
}: {
  refs: Refs;
  set: (p: Partial<Refs>) => void;
  hist: HistRefs;
  showChart: boolean;
  board: Board;
  /** mostrar só estes botões */
  only?: ('proj' | 't1' | 'y22' | 'chart')[];
  className?: string;
}) {
  const has = (k: 'proj' | 't1' | 'y22' | 'chart') => !only || only.includes(k);
  const value = [refs.proj && 'proj', refs.t1 && 't1', refs.y22 && 'y22', showChart && refs.chart && 'chart'].filter(Boolean) as string[];
  const item =
    // 32px visíveis + alvo de toque de 44px (pseudo-elemento), sem engordar o placar; ligado = fundo suave, a amostra do traço acende
    'group relative h-8 gap-1.5 rounded-full border border-border bg-transparent px-2.5 before:absolute before:-inset-y-1.5 before:inset-x-0 text-[12px] font-medium text-muted-foreground shadow-none hover:bg-accent hover:text-foreground data-[state=on]:border-foreground/50 data-[state=on]:bg-accent data-[state=on]:text-foreground';
  const sw = 'opacity-40 transition-opacity group-data-[state=on]:opacity-100';
  return (
    <ToggleGroup
      type="multiple"
      spacing={1.5}
      value={value}
      onValueChange={(v) =>
        set({
          ...(has('proj') ? { proj: v.includes('proj') } : {}),
          ...(has('t1') ? { t1: v.includes('t1') } : {}),
          ...(has('y22') ? { y22: v.includes('y22') } : {}),
          ...(showChart && has('chart') ? { chart: v.includes('chart') } : {}),
        })
      }
      aria-label="Mostrar camadas"
      className={cn('flex-wrap justify-start', className)}
    >
      {has('proj') && (
        <ToggleGroupItem value="proj" className={item} aria-label="Mostrar a projeção até 100% no gráfico" disabled={!board.projection}>
          <Swatch k="proj" cands={board.candidates} className={sw} />
          Projeção
        </ToggleGroupItem>
      )}
      {has('t1') && (
        <ToggleGroupItem value="t1" className={item} aria-label="Mostrar 1º turno 2026" disabled={hist.t1 === null}>
          <Swatch k="t1" cands={board.candidates} className={sw} />
          1º turno
        </ToggleGroupItem>
      )}
      {has('y22') && (
        <ToggleGroupItem value="y22" className={item} aria-label={`Mostrar 2º turno de 2022: ${matchup2022(board)}`}>
          <Swatch k="y22" cands={board.candidates} className={sw} />
          2022
        </ToggleGroupItem>
      )}
      {showChart && has('chart') && (
        <ToggleGroupItem value="chart" className={item} aria-label="Mostrar gráfico da noite">
          <ChartSpline className="size-3.5" aria-hidden />
          Gráfico
        </ToggleGroupItem>
      )}
    </ToggleGroup>
  );
}

/** legenda do gráfico: uma amostra do traço por camada desenhada */
function SparkLegend({ board, proj, y22, t1 }: { board: Board; proj: boolean; y22: boolean; t1: boolean }) {
  const items = [
    proj && ['proj', 'projeção até 100% · faixa de 95%'],
    y22 && ['y22', `2022: ${matchup2022(board)}`],
    t1 && ['t1', '1º turno'],
  ].filter(Boolean) as ['proj' | 'y22' | 't1', string][];
  return (
    <p className="mt-1 flex h-5 flex-wrap items-center gap-x-3 overflow-hidden text-[12px] text-muted-foreground">
      {items.map(([k, label]) => (
        <span key={k} className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <Swatch k={k} cands={board.candidates} />
          {label}
        </span>
      ))}
    </p>
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
  essential = false,
}: {
  board: Board;
  size?: 'md' | 'lg';
  chartAlways?: boolean;
  onInfo?: () => void;
  /** só o que importa (candidatos, votos, % apurado e a barra): o topo fixo da aba Chat */
  essential?: boolean;
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
  // antes das 19h (placar zerado da aba Chat): 0% para os dois, a barra fica neutra
  const zero = s?.status === 'nao_iniciada' && !s.valid;
  const marks: { v: number; label: string }[] = [];
  if (refs.t1 && hist.t1 !== null) marks.push({ v: hist.t1, label: '1º t.' });
  if (refs.y22 && hist.y22 !== null) marks.push({ v: hist.y22, label: '2022' });
  const status = s ? STATUS[s.status] : null;
  return (
    <section aria-label="Placar ao vivo" className={cn('relative', size === 'lg' ? 'p-0' : essential ? 'px-4 pt-3 pb-4' : 'px-4 pt-3 pb-2.5')}>
      {/* lg: vaza pelo p-6 do cartão da Home, que corta com overflow-hidden e os cantos arredondados */}
      <VersusGlow a={ca.color} b={cb.color} fadeBottom={chartAlways} className={size === 'lg' ? '-inset-6' : undefined} />
      <div className="relative">
        <div className="flex items-start justify-between gap-4">
          <Side c={ca} snap={s} pct={zero ? 0 : pa} lead={s?.lead === 'a'} align="l" size={size} />
          <Side c={cb} snap={s} pct={zero ? 0 : pa === null ? null : s!.pb} lead={s?.lead === 'b'} align="r" size={size} />
        </div>
        {/* apuração em cima da barra de votos: quanto do total aquele placar representa */}
        <div className={size === 'lg' ? 'mt-5' : 'mt-3'}>
          <div className="flex items-center justify-between gap-2 text-[12px] text-muted-foreground">
            <span className="num min-w-0 truncate">
              <span className="font-semibold text-foreground">{s ? s.pst.toLocaleString('pt-BR', PCT2) : '0,00'}%</span> das urnas apuradas
              {status && (
                <>
                  {' · '}
                  <span className={cn('font-semibold', s?.status === 'nao_iniciada' ? 'text-muted-foreground' : 'text-foreground')}>{status}</span>
                </>
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              <SourceStamp at={board.source.at} short className="text-[12px]" />
              {onInfo && (
                <button type="button" onClick={onInfo} className="relative -mr-1.5 flex size-8 items-center justify-center rounded-full before:absolute before:-inset-1.5 hover:bg-accent" aria-label="Sobre os dados e o projeto">
                  <Info className="size-3.5" aria-hidden />
                </button>
              )}
            </span>
          </div>
          <div
            className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-label="Urnas apuradas"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={s?.pst ?? 0}
          >
            <Fill pct={s?.pst ?? 0} className="rounded-full bg-foreground/80" />
          </div>
        </div>
        <VersusBar board={board} pa={pa} marks={marks} className={size === 'lg' ? 'mt-3' : 'mt-1.5'} />
        {essential ? null : (
          <>
            <RefLine t1={refs.t1 ? hist.t1 : null} y22={refs.y22 ? hist.y22 : null} who22={matchup2022(board)} />
            <div className={cn('relative flex items-center justify-between gap-2', size === 'lg' ? 'mt-4' : 'mt-2')}>
              {/* as camadas ficam dentro do gráfico; aqui fora, só o botão que abre o gráfico (aba Chat) */}
              {chartAlways ? (
                <span className="text-[12px] font-semibold">A noite até aqui</span>
              ) : (
                <RefChips refs={refs} set={setRefs} hist={hist} showChart only={['chart']} board={board} />
              )}
              <Link
                href="/painel"
                className="relative inline-flex h-8 shrink-0 items-center gap-0.5 rounded-full pr-1 pl-2 before:absolute before:-inset-y-1.5 before:inset-x-0 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                Painel
                <ChevronRight className="size-3.5" aria-hidden />
              </Link>
              {/* celular: o gráfico abre flutuando sobre o topo do chat, sem empurrar nada */}
              {showChart && !chartAlways && (
                <div className="animate-in fade-in-0 slide-in-from-top-1 absolute inset-x-0 top-full z-30 mt-2 rounded-xl border bg-card p-2.5 shadow-lg duration-200">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-[12px] font-semibold">A noite até aqui</span>
                    <button
                      type="button"
                      onClick={() => setRefs({ chart: false })}
                      className="relative -mr-1 flex size-8 items-center justify-center rounded-full before:absolute before:-inset-1.5 hover:bg-accent"
                      aria-label="Fechar gráfico"
                    >
                      <X className="size-4" aria-hidden />
                    </button>
                  </div>
                  <RefChips refs={refs} set={setRefs} hist={hist} showChart={false} board={board} className="mb-2" />
                  <NightSpark board={board} curve22={refs.y22 ? curve22 : null} t1={refs.t1 ? hist.t1 : null} flip22={flip22} proj={refs.proj} height={120} />
                  <SparkLegend board={board} proj={refs.proj && !!board.projection} y22={refs.y22 && !!curve22} t1={refs.t1 && hist.t1 !== null} />
                </div>
              )}
            </div>
          </>
        )}
        {chartAlways && (
          <div className="mt-2">
            <RefChips refs={refs} set={setRefs} hist={hist} showChart={false} board={board} className="mb-2" />
            <NightSpark board={board} curve22={refs.y22 ? curve22 : null} t1={refs.t1 ? hist.t1 : null} flip22={flip22} proj={refs.proj} height={size === 'lg' ? 297 : 203} />
            {/* linha reservada: ligar camadas não empurra o letreiro */}
            <SparkLegend board={board} proj={refs.proj && !!board.projection} y22={refs.y22 && !!curve22} t1={refs.t1 && hist.t1 !== null} />
          </div>
        )}
      </div>
    </section>
  );
}

/** Versão de uma linha (teclado aberto): avatares, % e barra. */
export function LiveScoreCompact({ board }: { board: Board }) {
  const s = board.br;
  const [ca, cb] = board.candidates;
  const pa = s && s.valid ? s.pa : null;
  const zero = s?.status === 'nao_iniciada' && !s.valid;
  return (
    <div className="flex items-center gap-2 px-3 py-2" aria-label="Placar">
      <CandidateAvatar c={ca} size="xs" ring={s?.lead === 'a'} />
      <span className="display min-w-[3.4rem] text-[16px] font-semibold">{pa === null ? (zero ? '0,0%' : '—') : <NumberFlow value={pa} format={PCT1} locales="pt-BR" suffix="%" />}</span>
      <div className="relative flex h-2 flex-1 gap-[2px] overflow-hidden rounded-full bg-muted">
        {pa !== null && (
          <>
            <SplitFill pa={pa} colorA={ca.color} colorB={cb.color} gap={2} />
          </>
        )}
        <div className="absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 bg-background" />
      </div>
      <span className="display min-w-[3.4rem] text-right text-[16px] font-semibold">{pa === null ? (zero ? '0,0%' : '—') : <NumberFlow value={100 - pa} format={PCT1} locales="pt-BR" suffix="%" />}</span>
      <CandidateAvatar c={cb} size="xs" ring={s?.lead === 'b'} />
      <span className="num ml-1 text-[11px] text-muted-foreground">{s ? `${fmt1(s.pst)}%` : ''}</span>
    </div>
  );
}

/**
 * Topo da aba Chat (celular): o essencial do placar em pouca altura, para sobrar tela para a conversa.
 * Antes das 19h, a contagem no lugar dos números (sem 0,00% nem barras vazias); depois, os dois %, a barra e o apurado.
 */
export function LiveScoreEssential({ board }: { board: Board }) {
  const s = board.br;
  const [ca, cb] = board.candidates;
  const now = useNow(1000);
  const started = board.released && !!s && s.valid > 0;
  const name = (c: CandidateDef, align: 'l' | 'r', pct: number | null, lead: boolean) => (
    <div className={cn('flex min-w-0 flex-1 items-center gap-2', align === 'r' && 'flex-row-reverse text-right')}>
      <CandidateAvatar c={c} size="sm" ring={lead} priority />
      <div className="min-w-0">
        <div className="truncate text-[13px] leading-tight font-semibold">{c.short}</div>
        {pct === null ? (
          <div className="truncate text-[11px] text-muted-foreground">{c.party}</div>
        ) : (
          <div className={cn('display text-[19px] leading-tight font-semibold', !lead && 'text-foreground/60')}>
            <NumberFlow value={pct} format={PCT2} locales="pt-BR" suffix="%" willChange />
          </div>
        )}
      </div>
    </div>
  );
  if (!started) {
    const left = Date.parse(board.releaseAt) - now;
    return (
      <section aria-label="Placar" className="flex items-center gap-2 px-4 py-2.5">
        {name(ca, 'l', null, false)}
        <div className="shrink-0 text-center leading-tight">
          <div className="text-[10px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{board.released ? 'Aguardando' : 'Placar abre em'}</div>
          <div className="num text-[15px] font-bold">{board.released ? 'as urnas' : left > 0 ? fmtCountdown(left) : 'instantes'}</div>
        </div>
        {name(cb, 'r', null, false)}
      </section>
    );
  }
  const st = STATUS[s!.status];
  return (
    <section aria-label="Placar ao vivo" className="px-4 pt-2.5 pb-2">
      <div className="flex items-center gap-2">
        {name(ca, 'l', s!.pa, s!.lead === 'a')}
        {name(cb, 'r', s!.pb, s!.lead === 'b')}
      </div>
      <div className="relative mt-2 flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-muted" aria-hidden>
        <SplitFill pa={s!.pa} colorA={ca.color} colorB={cb.color} gap={2} />
      </div>
      <div className="num mt-1 text-center text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">{s!.pst.toLocaleString('pt-BR', PCT2)}%</span> das urnas apuradas
        {st ? ` · ${st}` : ''}
      </div>
    </section>
  );
}
