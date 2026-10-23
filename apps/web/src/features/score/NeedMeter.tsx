// "Vira ou não vira": medidor em arco. O arco colorido é o que o candidato atrás tem até agora;
// a agulha é o quanto ele precisa dos votos que faltam. Agulha além do arco = precisa melhorar o ritmo.
import type { Board, Snap } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { Gauge } from 'lucide-react';
import { CandidateAvatar } from '@/components/core/candidate';
import { fmtCompact, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Section } from './Section';

/**
 * Veredito pelo quanto precisa do que falta (não pela distância do parcial: no começo da noite o
 * parcial ainda não representa o país). "Vira no ritmo atual" só quando o próprio ritmo já basta.
 */
function verdict(need: number | null, have: number) {
  if (need === null) return { label: 'Sem estimativa', tone: 'text-muted-foreground bg-muted' };
  if (need > 100) return { label: 'Fora de alcance pela estimativa', tone: 'text-muted-foreground bg-muted' };
  if (have >= need) return { label: 'No ritmo atual, vira', tone: 'text-live bg-live/12' };
  if (need < 52) return { label: 'Totalmente aberto', tone: 'text-warning bg-warning/12' };
  if (need < 55) return { label: 'Aberto', tone: 'text-warning bg-warning/12' };
  if (need < 60) return { label: 'Difícil', tone: 'text-muted-foreground bg-muted' };
  return { label: 'Muito difícil', tone: 'text-muted-foreground bg-muted' };
}

// geometria do arco (viewBox 260×150)
const CX = 130;
const CY = 132;
const R = 104;
const SW = 16;
const ang = (v: number) => Math.PI - (Math.max(0, Math.min(100, v)) / 100) * Math.PI;
const pt = (v: number, r = R) => [CX + r * Math.cos(ang(v)), CY - r * Math.sin(ang(v))] as const;
function arc(from: number, to: number) {
  const [x0, y0] = pt(from);
  const [x1, y1] = pt(to);
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${R},${R} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`;
}

function Arc({ have, need, color }: { have: number; need: number | null; color: string }) {
  const n = need === null ? null : Math.min(100, need);
  // ponteiro que atravessa o anel (o centro fica livre para o número)
  const [ix, iy] = n === null ? [0, 0] : pt(n, R - SW / 2 - 7);
  const [ox, oy] = n === null ? [0, 0] : pt(n, R + SW / 2 + 7);
  return (
    <svg viewBox="0 0 260 150" className="mx-auto block w-full max-w-[320px]" aria-hidden>
      <path d={arc(0, 100)} fill="none" stroke="var(--muted)" strokeWidth={SW} strokeLinecap="round" />
      {have > 0.2 && <path d={arc(0, have)} fill="none" stroke={color} strokeWidth={SW} strokeLinecap="round" />}
      {/* 50%: a linha de chegada */}
      <line x1={CX} y1={CY - R - SW / 2 - 2} x2={CX} y2={CY - R + SW / 2 + 2} stroke="var(--card)" strokeWidth={2} />
      <text x={CX} y={CY - R - SW / 2 - 8} textAnchor="middle" className="num fill-muted-foreground text-[11px]">
        50%
      </text>
      {n !== null && (
        <g>
          <line x1={ix} y1={iy} x2={ox} y2={oy} stroke="var(--card)" strokeWidth={7} strokeLinecap="round" />
          <line x1={ix} y1={iy} x2={ox} y2={oy} stroke="var(--foreground)" strokeWidth={3.5} strokeLinecap="round" />
        </g>
      )}
      <text x={CX - R} y={CY + 17} textAnchor="middle" className="num fill-muted-foreground text-[11px]">
        0%
      </text>
      <text x={CX + R} y={CY + 17} textAnchor="middle" className="num fill-muted-foreground text-[11px]">
        100%
      </text>
    </svg>
  );
}

export function NeedMeter({ board, snap, className }: { board: Board; snap: Snap; className?: string }) {
  if (snap.status === 'nao_iniciada' || !snap.lead) return null;
  const lead = board.candidates.find((c) => c.key === snap.lead)!;
  const trail = board.candidates.find((c) => c.key !== snap.lead)!;
  const trailNow = snap.lead === 'a' ? snap.pb : snap.pa;

  if (snap.status === 'definido' || snap.status === 'totalizado') {
    return (
      <Section icon={Gauge} title="Vira ou não vira?" className={className}>
        <div className="flex items-start gap-3">
          <CandidateAvatar c={lead} size="sm" ring />
          <p className="text-[14px] leading-relaxed">
            {snap.status === 'definido' ? (
              <>
                <strong>Não vira mais.</strong> A vantagem de {lead.short} ({fmtCompact(Math.abs(snap.a - snap.b))} votos) já é maior que
                todo o eleitorado que falta apurar ({fmtCompact(snap.rmax)}). O resultado oficial é o da totalização do TSE.
              </>
            ) : (
              <>Apuração encerrada pelo TSE.</>
            )}
          </p>
        </div>
      </Section>
    );
  }

  const need = snap.need;
  const out = need !== null && need > 100;
  const v = verdict(need, trailNow);
  return (
    <Section
      icon={Gauge}
      title="Vira ou não vira?"
      meta={<span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', v.tone)}>{v.label}</span>}
      className={className}
    >
      <div
        className="chart relative"
        role="img"
        aria-label={`Gráfico do vira ou não vira: ${trail.short} tem ${fmtPct(trailNow, 1)}% até agora e precisa de ${need === null ? 'dado indisponível' : out ? 'mais de 100' : fmtPct(need, 1)}% dos votos que faltam`}
      >
        <Arc have={trailNow} need={need} color={trail.color} />
        <div className="pointer-events-none absolute inset-x-0 bottom-[14%] flex flex-col items-center text-center">
          <span className="text-[11px] text-muted-foreground">precisa de</span>
          <span className="display text-[30px] leading-none font-semibold">
            {need === null ? '—' : out ? '>100%' : <NumberFlow value={need} format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }} locales="pt-BR" suffix="%" />}
          </span>
          <span className="text-[11px] text-muted-foreground">do que falta</span>
        </div>
      </div>
      <div className="mt-1 flex items-center gap-2.5">
        <CandidateAvatar c={trail} size="sm" />
        <p className="text-[13px] leading-snug">
          <strong style={{ color: trail.color }}>{trail.short}</strong> tem <strong className="num">{fmtPct(trailNow, 1)}%</strong> até agora. Para
          virar, precisa de {need === null ? '—' : out ? 'mais do que todos' : `${fmtPct(need, 1)}%`} dos ~{fmtCompact(snap.rem)} votos válidos que faltam.
        </p>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        {out
          ? 'Pela estimativa, não alcança mais. Só é impossível de fato quando a vantagem supera todo o eleitorado que falta.'
          : 'Estimativa pelo comparecimento de cada estado. Quanto mais o ponteiro passa do arco colorido, mais o ritmo precisa mudar.'}
      </p>
    </Section>
  );
}
