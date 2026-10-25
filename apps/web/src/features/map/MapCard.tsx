// Cartão do mapa para a home e o painel: a grade de hexágonos (estática; o zoom fica na aba Mapa), os chips de
// camada (Agora, 1º turno, 2022, como nos gráficos), a contagem de estados por candidato e o atalho para a aba Mapa. Mouse por cima ou toque num estado mostra a ficha dele;
// clique (mouse) abre o estado na aba Mapa.
import { fmtPct } from '@apuracao/shared';
import { ArrowRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { ghostBoard } from '@/lib/ghost';
import { matchup2022 } from '@/lib/y2022';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import HexMap, { type HexHit } from './HexMap';
import { UfTip } from './UfTip';
import { useStateValues, type MapLayer } from './data';
import { LayerChips } from './LayerChips';
import { MapLegend } from './Legend';

export default function MapCard() {
  const board = useBoard((s) => s.board);
  const started = !!board?.released && !!board.br;
  const [pick, setPick] = useState<MapLayer | null>(null);
  // sem escolha: ao vivo depois das 19h, o 1º turno antes; "Agora" escolhido antes da hora vira 1º turno
  const want: MapLayer = pick === null || (pick === 'live' && !started) ? (started ? 'live' : 't1') : pick;
  const { values, layer } = useStateValues(board, want);
  const [tip, setTip] = useState<HexHit | null>(null);
  const [, go] = useLocation();
  const pointer = useRef('mouse');
  const wrap = useRef<HTMLDivElement>(null);
  // toque fora do mapa fecha a ficha
  useEffect(() => {
    if (!tip) return;
    const off = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setTip(null);
    addEventListener('pointerdown', off);
    return () => removeEventListener('pointerdown', off);
  }, [tip]);
  // sem placar ainda: o próprio cartão em fantasma, com a altura certa (o rodapé e o resto da tela não pulam)
  const ghost = !board;
  const shown = board ?? ghostBoard();
  const cands = shown.candidates;
  let a = 0;
  let b = 0;
  for (const [uf, v] of Object.entries(values)) {
    if (uf === 'ZZ' || v?.pa == null) continue;
    if (v.pa > 50) a++;
    else if (v.pa < 50) b++;
  }
  const live = ghost || layer === 'live';
  const caption = live ? (shown.br ? `${fmtPct(shown.br.pst, 1)}% apurado` : 'Parcial') : layer === 't1' ? '1º turno' : `2º turno de 2022 · ${matchup2022(shown)}`;

  return (
    <section className={cn('rounded-2xl border bg-card', ghost && 'ghost')} aria-busy={ghost || undefined} aria-hidden={ghost || undefined}>
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">Mapa</h2>
          <p className="truncate text-xs text-muted-foreground">{caption}</p>
        </div>
        <Link href="/mapa" className="press inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground">
          Abrir mapa <ArrowRight className="size-4" />
        </Link>
      </div>

      {!ghost && <LayerChips value={layer} onChange={setPick} cands={cands} live={started} who22={matchup2022(shown)} className="px-4 pt-3" />}

      <div ref={wrap} className="relative mx-auto max-w-[420px] px-3 pt-2" onPointerDownCapture={(e) => (pointer.current = e.pointerType)}>
        <HexMap
          cands={cands}
          layer={live ? 'live' : layer}
          zoomable={false}
          onHover={setTip}
          onPick={(hit) => {
            if (pointer.current === 'mouse') return go(hit ? `/mapa/${hit.uf}` : '/mapa');
            setTip((cur) => (hit && cur?.uf !== hit.uf ? hit : null));
          }}
          label="Mapa do Brasil em hexágonos, na cor de quem lidera em cada região. Passe o mouse ou toque num estado para ver o placar dele."
        />
        {tip && <UfTip uf={tip.uf} x={tip.x + 12} y={tip.y + 8} value={values[tip.uf]} cands={cands} />}
      </div>

      <div className="flex items-center justify-between gap-2 border-t px-4 py-3">
        {[
          { c: cands[0], n: a },
          { c: cands[1], n: b },
        ].map(({ c, n }, i) => (
          <div key={c.key} className={i ? 'order-3 flex shrink-0 items-center gap-2 text-right' : 'order-1 flex shrink-0 items-center gap-2'}>
            {!i && <CandidateAvatar c={c} size="sm" />}
            <div>
              <div className="num text-base font-semibold leading-none" style={{ color: c.color }}>
                {n}
              </div>
              <div className="text-[11px] text-muted-foreground">{n === 1 ? 'estado' : 'estados'}</div>
            </div>
            {!!i && <CandidateAvatar c={c} size="sm" />}
          </div>
        ))}
        <MapLegend cands={cands} compact bare className="order-2" />
      </div>
    </section>
  );
}
