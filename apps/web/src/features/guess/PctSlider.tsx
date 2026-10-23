// Slider de palpite: % de A (B é o complemento). Trilho bicolor, marca dos 50%, ajuste fino.
import type { CandidateDef } from '@apuracao/shared';
import { Slider } from 'radix-ui';
import { CandidateAvatar } from '@/components/core/candidate';
import { cn } from '@/lib/utils';
import { Pct } from './bits';

export const MIN = 30;
export const MAX = 70;
const clamp = (v: number) => Math.round(Math.max(MIN, Math.min(MAX, v)) * 10) / 10;

export function PctSlider({
  value,
  onChange,
  ca,
  cb,
  size = 'lg',
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  ca: CandidateDef;
  cb: CandidateDef;
  size?: 'lg' | 'sm';
  label: string;
}) {
  const set = (v: number) => onChange(clamp(v));
  const big = size === 'lg';
  const leadA = value > 50;
  const leadB = value < 50;
  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <ScoreSide c={ca} v={value} lead={leadA} dim={leadB} big={big} />
        <ScoreSide c={cb} v={100 - value} lead={leadB} dim={leadA} big={big} right />
      </div>

      <Slider.Root
        value={[value]}
        min={MIN}
        max={MAX}
        step={0.1}
        onValueChange={([v]) => set(v)}
        className={cn('relative mt-4 flex w-full touch-none items-center select-none', big ? 'h-11' : 'h-9')}
        aria-label={label}
      >
        <Slider.Track className={cn('relative grow overflow-hidden rounded-full', big ? 'h-3' : 'h-2')} style={{ background: cb.color }}>
          <Slider.Range className="absolute h-full" style={{ background: ca.color, left: 0 }} />
        </Slider.Track>
        {/* 50%: a linha que decide a eleição */}
        <span className="pointer-events-none absolute left-1/2 h-5 w-0.5 -translate-x-1/2 rounded-full bg-background" aria-hidden />
        <Slider.Thumb
          className={cn(
            'block rounded-full border-2 border-background bg-white shadow-[0_1px_2px_rgba(0,0,0,0.25),0_4px_12px_rgba(0,0,0,0.2)] outline-none transition-transform duration-150 ease-out focus-visible:ring-4 focus-visible:ring-ring/50 active:scale-110',
            big ? 'size-7' : 'size-6',
          )}
          aria-valuetext={`${ca.short} ${value.toLocaleString('pt-BR')}%, ${cb.short} ${(100 - value).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`}
        />
      </Slider.Root>
      <div className="relative mt-0.5 h-4 text-[10px] text-muted-foreground" aria-hidden>
        <span className="absolute left-0">{MIN}%</span>
        <span className="absolute left-1/2 -translate-x-1/2">50%</span>
        <span className="absolute right-0">{MAX}%</span>
      </div>

      <div className="mt-3 grid grid-cols-5 gap-1.5" role="group" aria-label={`Ajuste fino do percentual de ${ca.short}`}>
        <Fine onClick={() => set(value - 1)} label={`${ca.short} menos 1 ponto`}>−1</Fine>
        <Fine onClick={() => set(value - 0.1)} label={`${ca.short} menos 0,1 ponto`}>−0,1</Fine>
        <Fine onClick={() => set(50)} label="Empate 50/50" muted>
          50/50
        </Fine>
        <Fine onClick={() => set(value + 0.1)} label={`${ca.short} mais 0,1 ponto`}>+0,1</Fine>
        <Fine onClick={() => set(value + 1)} label={`${ca.short} mais 1 ponto`}>+1</Fine>
      </div>
      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">ajuste fino do % de {ca.short}</p>
    </div>
  );
}

export function ScoreSide({ c, v, lead, dim, big, right = false }: { c: CandidateDef; v: number; lead: boolean; dim: boolean; big: boolean; right?: boolean }) {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col gap-2', right && 'items-end text-right')}>
      <div className={cn('flex min-w-0 items-center gap-2', right && 'flex-row-reverse')}>
        <CandidateAvatar c={c} size={big ? 'md' : 'sm'} ring={lead} />
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[13px] font-medium">{c.short}</div>
          {c.party && <div className="text-[11px] text-muted-foreground">{c.party}</div>}
        </div>
      </div>
      <Pct v={v} digits={1} className={cn('display block font-semibold leading-none', big ? 'text-[40px]' : 'text-[26px]', dim && 'text-muted-foreground')} />
    </div>
  );
}

function Fine({ children, onClick, label, muted }: { children: React.ReactNode; onClick: () => void; label: string; muted?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        'num h-10 rounded-lg border bg-background text-[13px] font-semibold transition-colors duration-150 hover:bg-accent active:scale-[0.97]',
        muted && 'font-medium text-muted-foreground',
      )}
    >
      {children}
    </button>
  );
}
