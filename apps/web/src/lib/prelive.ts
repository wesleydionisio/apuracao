// Antes das 17h o servidor não publica placar nenhum (nem zerado: garantia legal, aplicada no poller e no WS).
// Para o site já mostrar todos os painéis montados — e o visitante ver antes o que vai ter —, o front desenha os
// mesmos componentes do ao vivo sobre um placar ZERADO: 0% apurado, "aguardando", nenhum número inventado.
// `released` continua false, então cada componente sabe que é a véspera.
import type { Board, Snap } from '@apuracao/shared';
import { UFS } from '@apuracao/shared';

const zero = (s: string, at: string): Snap => ({
  s,
  at,
  pst: 0,
  a: 0,
  b: 0,
  pa: 0,
  pb: 0,
  valid: 0,
  blank: 0,
  nulls: 0,
  el: 0,
  elc: 0,
  turnout: 0,
  status: 'nao_iniciada',
  lead: null,
  need: null,
  rem: 0,
  rmax: 0,
});

const cache = new WeakMap<Board, Board>();

/** o placar como ele é antes da apuração começar: zerado, com todas as UFs */
export function preBoard(board: Board): Board {
  if (board.released && board.br) return board;
  const hit = cache.get(board);
  if (hit) return hit;
  const at = board.releaseAt;
  const out: Board = {
    ...board,
    br: zero('br', at),
    ufs: Object.fromEntries(Object.keys(UFS).map((uf) => [`uf:${uf}`, zero(`uf:${uf}`, at)])),
    remaining: [],
    projection: null,
    curve: [],
    moments: [],
  };
  cache.set(board, out);
  return out;
}

/** é a véspera (antes das 17h)? */
export const isPre = (board: Board) => !board.released;
