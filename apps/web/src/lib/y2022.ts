// Quem disputou o 2º turno de 2022 com cada número: a referência "2022" é do partido/número, não do candidato de hoje
// (em 2026 o 22 é Flávio Bolsonaro; em 2022 foi Jair Bolsonaro). Os rótulos dizem quem foi, para não confundir.
import type { Board, CandidateDef, Side } from '@apuracao/shared';

export const NAMES_2022: Record<string, string> = { '13': 'Lula', '22': 'Jair Bolsonaro' };

/** nome de quem usou, em 2022, o número do lado `side` (pelo mapeamento y2022Map) */
export function name2022(board: Board, side: Side): string | null {
  return NAMES_2022[board.y2022Map[side]] ?? null;
}

/** o candidato de hoje é a mesma pessoa de 2022 naquele lado? */
export function same2022(board: Board, c: CandidateDef): boolean {
  const n = name2022(board, c.key);
  return !n || n.toLowerCase() === c.short.toLowerCase() || n.toLowerCase() === c.name.toLowerCase();
}

/** "2022" para quem é o mesmo; "2022 · Jair" para quem não é */
export function label2022(board: Board, c: CandidateDef): string {
  return same2022(board, c) ? '2022' : `2022 · ${name2022(board, c.key)!.split(' ')[0]}`;
}

/** "Lula × Jair Bolsonaro" (na ordem A × B) */
export function matchup2022(board: Board): string {
  return [name2022(board, 'a') ?? `nº ${board.y2022Map.a}`, name2022(board, 'b') ?? `nº ${board.y2022Map.b}`].join(' × ');
}
