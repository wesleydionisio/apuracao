import type { Snap } from '@apuracao/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export const STATUS_LABEL: Record<Snap['status'], string> = {
  nao_iniciada: 'Apuração não iniciada',
  apurando: 'Em apuração',
  definido: 'Matematicamente definido',
  totalizado: 'Totalização concluída pelo TSE',
};

const SHORT: Record<Snap['status'], string> = {
  nao_iniciada: 'Não iniciada',
  apurando: 'Em apuração',
  definido: 'Matematicamente definido',
  totalizado: 'Totalizado pelo TSE',
};

export function StatusBadge({ s, short = false, className }: { s: Snap['status']; short?: boolean; className?: string }) {
  return (
    <Badge
      variant="secondary"
      className={cn(
        'h-6 gap-1.5 rounded-full px-2.5 text-[11px] font-medium',
        s === 'apurando' && 'bg-live/12 text-live',
        (s === 'definido' || s === 'totalizado') && 'bg-foreground text-background',
        s === 'nao_iniciada' && 'text-muted-foreground',
        className,
      )}
    >
      {s === 'apurando' && <span className="live-dot size-1.5 rounded-full bg-live" aria-hidden />}
      {short ? SHORT[s] : STATUS_LABEL[s]}
    </Badge>
  );
}
