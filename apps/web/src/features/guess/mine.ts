// O palpite deste aparelho e se os palpites ainda estão abertos. Módulo leve: a tela Ao vivo usa sem puxar o ticket.
import type { Board } from '@apuracao/shared';

export const MY_GUESS = 'my-guess';

export function myGuessId(): string | null {
  try {
    return localStorage.getItem(MY_GUESS);
  } catch {
    return null;
  }
}

export function guessesOpen(board: Board | null, now = Date.now()) {
  return !!board && now < Date.parse(board.releaseAt);
}
