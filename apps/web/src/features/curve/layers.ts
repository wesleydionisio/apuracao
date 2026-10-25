// Camadas dos gráficos da noite e como cada uma se desenha (o mesmo nos dois gráficos, nos chips e nas legendas).
// Hoje: linha cheia nas cores dos candidatos. Projeção: pontilhado redondo nas cores dos candidatos, com a faixa.
// 2022: tracejado longo violeta. 1º turno: traço-ponto âmbar. Cor e traço diferentes: dá para ler sem depender só da cor.
import type { Board } from '@apuracao/shared';

export const LAYER = {
  proj: { dash: '0.1 5', width: 2, cap: 'round' as const },
  y22: { color: 'var(--ref-y22)', dash: '7 4', width: 1.5 },
  t1: { color: 'var(--ref-t1)', dash: '9 3 2 3', width: 1.5 },
};

export interface ProjPoint {
  /** % apurado */
  x: number;
  /** % de A: caminho central e faixa de 95% */
  mid: number;
  lo: number;
  hi: number;
}

/**
 * Caminho da projeção do ponto de agora até 100%: se o que falta chegar aos poucos, na proporção, o parcial em cada
 * instante é o contado mais uma fração w do resto estimado (`projection.rem`); em w = 1 é a projeção final.
 * A faixa sai do mesmo jeito com o piso e o teto de 95%. null quando não há projeção para desenhar.
 */
export function projectionPath(board: Board, n = 32): { pts: ProjPoint[]; pa: number; lo: number; hi: number } | null {
  const p = board.projection;
  const br = board.br;
  if (!board.flags.projection || !p || !br || !br.valid || !p.rem || br.pst >= 99.8) return null;
  const V = br.a + br.b;
  const R = p.rem;
  const at = (final: number, w: number) => ((br.a + w * ((final / 100) * (V + R) - br.a)) / (V + w * R)) * 100;
  const pts = Array.from({ length: n + 1 }, (_, i) => {
    const w = i / n;
    return { x: br.pst + w * (100 - br.pst), mid: at(p.pa, w), lo: at(p.lo, w), hi: at(p.hi, w) };
  });
  return { pts, pa: p.pa, lo: p.lo, hi: p.hi };
}
