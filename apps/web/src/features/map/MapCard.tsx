// Cartão do mapa para a home e o painel: a grade de hexágonos (estática; o zoom fica na aba Mapa), a contagem
// de estados por candidato e o atalho para a aba Mapa.
import { fmtPct } from '@apuracao/shared';
import { ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { Skeleton } from '@/components/ui/skeleton';
import { useBoard } from '@/store/board';
import HexMap from './HexMap';
import { useStateValues } from './data';
import { MapLegend } from './Legend';

export default function MapCard() {
  const board = useBoard((s) => s.board);
  const { values, layer } = useStateValues(board);
  if (!board) return <Skeleton className="h-[420px] w-full rounded-2xl" />;
  const cands = board.candidates;
  let a = 0;
  let b = 0;
  for (const [uf, v] of Object.entries(values)) {
    if (uf === 'ZZ' || v?.pa == null) continue;
    if (v.pa > 50) a++;
    else if (v.pa < 50) b++;
  }
  const live = layer === 'live';

  return (
    <section className="rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">Mapa</h2>
          <p className="text-xs text-muted-foreground">
            {live ? (board.br ? `Parcial com ${fmtPct(board.br.pst, 1)}% apurado` : 'Parcial') : '1º turno, só os dois finalistas'}
          </p>
        </div>
        <Link href="/mapa" className="press inline-flex min-h-10 shrink-0 items-center gap-1 rounded-lg px-2 text-sm font-medium whitespace-nowrap text-muted-foreground hover:text-foreground">
          Abrir mapa <ArrowRight className="size-4" />
        </Link>
      </div>

      <Link href="/mapa" aria-label="Abrir o mapa" className="block px-3 pt-2">
        <HexMap
          cands={cands}
          layer={live ? 'live' : 't1'}
          zoomable={false}
          className="mx-auto max-w-[420px]"
          label="Mapa do Brasil em hexágonos, na cor de quem lidera em cada região"
        />
      </Link>

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
