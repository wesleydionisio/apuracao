// "Vira ou não vira": quanto dos votos que faltam o candidato atrás precisa, comparado ao que tem.
import type { Board, Snap } from '@apuracao/shared';
import { Calculator } from 'lucide-react';
import { CandidateAvatar } from '@/components/core/candidate';
import { Card, Title } from '@/components/ui';
import { fmtCompact, fmtPct } from '@/lib/format';
import { cn } from '@/lib/utils';

function verdict(gap: number, out: boolean) {
  if (out) return { label: 'Fora de alcance pela estimativa', tone: 'text-muted-foreground bg-muted' };
  if (gap <= 0) return { label: 'Ritmo atual vira', tone: 'text-live bg-live/12' };
  if (gap < 2.5) return { label: 'Ao alcance', tone: 'text-warning bg-warning/12' };
  if (gap < 6) return { label: 'Difícil', tone: 'text-muted-foreground bg-muted' };
  return { label: 'Muito difícil', tone: 'text-muted-foreground bg-muted' };
}

export function NeedMeter({ board, snap }: { board: Board; snap: Snap }) {
  if (snap.status === 'nao_iniciada' || !snap.lead) return null;
  const lead = board.candidates.find((c) => c.key === snap.lead)!;
  const trail = board.candidates.find((c) => c.key !== snap.lead)!;
  const trailNow = snap.lead === 'a' ? snap.pb : snap.pa;

  if (snap.status === 'definido' || snap.status === 'totalizado') {
    return (
      <Card>
        <Title>Vira ou não vira?</Title>
        <div className="flex gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted">
            <Calculator className="size-4" aria-hidden />
          </span>
          <p className="text-[14px] leading-relaxed">
            {snap.status === 'definido' ? (
              <>
                <strong>Não vira mais.</strong> A vantagem de {lead.short} ({fmtCompact(Math.abs(snap.a - snap.b))} votos) é maior
                que todo o eleitorado que ainda falta apurar ({fmtCompact(snap.rmax)}). O resultado oficial é o da totalização do TSE.
              </>
            ) : (
              <>Apuração encerrada pelo TSE.</>
            )}
          </p>
        </div>
      </Card>
    );
  }

  const need = snap.need;
  const out = need !== null && need > 100;
  const pos = Math.min(100, Math.max(0, need ?? 50));
  const v = verdict((need ?? 50) - trailNow, out);
  return (
    <Card>
      <Title right={<span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', v.tone)}>{v.label}</span>}>
        Vira ou não vira?
      </Title>
      <div className="flex items-center gap-3">
        <CandidateAvatar c={trail} size="sm" />
        <p className="text-[14px] leading-snug">
          Para virar, <strong style={{ color: trail.color }}>{trail.short}</strong> precisa de{' '}
          <strong className="display text-[18px]">{need === null ? '—' : out ? '+100' : fmtPct(need, 1)}%</strong> dos ~
          {fmtCompact(snap.rem)} votos que faltam.
        </p>
      </div>

      {/* medidor: tem até agora (barra) × precisa (marcador) */}
      <div className="relative mt-5 mb-1 h-10" role="img" aria-label={`Tem ${fmtPct(trailNow, 1)}% até agora; precisa de ${need === null ? 'dado indisponível' : fmtPct(need, 1)}% do que falta`}>
        <div className="absolute inset-x-0 top-4 h-2.5 rounded-full bg-muted" />
        <div
          className="absolute top-4 h-2.5 rounded-full transition-[width] duration-700 ease-out"
          style={{ width: `${Math.min(100, trailNow)}%`, background: trail.color }}
        />
        <div className="absolute top-2 h-6.5 w-px bg-foreground/30" style={{ left: '50%' }} />
        <div className="absolute top-0 flex -translate-x-1/2 flex-col items-center transition-[left] duration-700 ease-out" style={{ left: `${pos}%` }}>
          <div className="h-10 w-[3px] rounded-full bg-foreground" />
        </div>
      </div>
      <div className="num relative h-8 text-[11px]">
        <span className="absolute left-0 text-muted-foreground">0%</span>
        <span className="absolute -translate-x-1/2 font-medium" style={{ left: `${Math.min(88, Math.max(12, trailNow))}%`, color: trail.color }}>
          tem {fmtPct(trailNow, 1)}%
        </span>
        <span className="absolute top-4 -translate-x-1/2 font-semibold" style={{ left: `${Math.min(88, Math.max(12, pos))}%` }}>
          precisa {need === null ? '—' : out ? '>100' : fmtPct(need, 1)}%
        </span>
        <span className="absolute right-0 text-muted-foreground">100%</span>
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
        {out
          ? 'Pela estimativa de votos restantes, não alcança mais. Só é impossível de fato quando a vantagem supera todo o eleitorado que falta.'
          : 'Estimativa pelo comparecimento de cada estado. Quanto mais perto de 50%, mais aberta está a disputa.'}
      </p>
    </Card>
  );
}
