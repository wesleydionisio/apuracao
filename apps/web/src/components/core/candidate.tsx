// Identidade visual dos candidatos: foto oficial do TSE, cor e nome. Usado em todas as telas.
import type { Board, CandidateDef, Side } from '@apuracao/shared';
import { useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';

/** candidatos do Board atual (null antes do primeiro carregamento) */
export function useCandidates(): [CandidateDef, CandidateDef] | null {
  const c = useBoard((s) => s.board?.candidates);
  return c && c.length === 2 ? [c[0], c[1]] : null;
}

export const candOf = (b: Board | null | undefined, side: Side) => b?.candidates.find((c) => c.key === side);

/** publica as cores do Board como --cand-a / --cand-b (classes text-cand-a, bg-cand-b, …) */
export function useCandidateCssVars() {
  const c = useCandidates();
  useEffect(() => {
    if (!c) return;
    const root = document.documentElement.style;
    root.setProperty('--cand-a', c[0].color);
    root.setProperty('--cand-b', c[1].color);
  }, [c?.[0].color, c?.[1].color]);
}

const initials = (name: string) => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[w.length - 1][0] : (w[0] ?? '?').slice(0, 2)).toUpperCase();
};

const SIZES = {
  xs: 'size-6 rounded-md text-[11px]',
  sm: 'size-8 rounded-lg text-xs',
  md: 'size-11 rounded-xl text-sm',
  lg: 'size-14 rounded-2xl text-base',
  xl: 'size-20 rounded-2xl text-xl',
} as const;

/**
 * Foto oficial (161×225, fundo branco) recortada no rosto.
 * `ring` desenha o contorno na cor do candidato (para destacar quem está à frente).
 */
export function CandidateAvatar({
  c,
  size = 'md',
  ring = false,
  priority = false,
  className,
}: {
  c: CandidateDef;
  size?: keyof typeof SIZES;
  ring?: boolean;
  /** foto na primeira tela (placar): carrega já e com prioridade, é o maior elemento visível */
  priority?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden bg-muted font-semibold text-white select-none',
        SIZES[size],
        ring && 'ring-2 ring-offset-2 ring-offset-background',
        className,
      )}
      style={{ ...(ring ? { ['--tw-ring-color' as string]: c.color } : {}), background: c.photo ? 'var(--photo-bg)' : c.color }}
      aria-hidden
    >
      {c.photo ? (
        <img
          src={c.photo}
          alt=""
          width={161}
          height={225}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          {...(priority ? { fetchpriority: 'high' } : {})}
          className="size-full object-cover object-[50%_18%]"
          draggable={false}
        />
      ) : (
        initials(c.name)
      )}
    </span>
  );
}

/** nome curto com o ponto de cor — para legendas, tabelas e eixos */
export function CandidateTag({ c, className }: { c: CandidateDef; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-medium', className)}>
      <span className="size-2 shrink-0 rounded-full" style={{ background: c.color }} />
      {c.short}
    </span>
  );
}
