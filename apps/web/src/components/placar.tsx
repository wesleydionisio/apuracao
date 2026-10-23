// Compatibilidade: os blocos do placar vivem em @/features/score. Nomes antigos mantidos.
import type { Board, Snap } from '@apuracao/shared';
import { CandidateRows } from '@/features/score/CandidateRows';
import { MomentsTimeline } from '@/features/score/Moments';
import { NeedMeter } from '@/features/score/NeedMeter';
import { ProjectionBand } from '@/features/score/Projection';
import { RemainingTable } from '@/features/score/Remaining';
import { StatsStrip } from '@/features/score/StatsStrip';
import { StatusBadge } from '@/features/score/status';
import { Card } from './ui';

export { momentShare } from '@/features/score/Moments';
export { STATUS_LABEL } from '@/features/score/status';

export function StatusChip({ s }: { s: Snap['status'] }) {
  return <StatusBadge s={s} />;
}

/** Placar de um escopo (Brasil, UF ou cidade): título, status, linhas dos candidatos e números. */
export function ScoreCard({ board, snap, title }: { board: Board; snap: Snap; title?: string }) {
  return (
    <Card>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{title ?? 'Presidente · Brasil'}</h2>
        <StatusBadge s={snap.status} short />
      </div>
      <CandidateRows board={board} snap={snap} />
      <StatsStrip snap={snap} className="mt-2" />
    </Card>
  );
}

export const NeedBar = NeedMeter;
export const ProjectionCard = ProjectionBand;
export const Remaining = RemainingTable;
export const MomentsFeed = MomentsTimeline;
