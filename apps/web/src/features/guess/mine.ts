// O palpite deste aparelho e se os palpites ainda estão abertos. Módulo leve: a tela Ao vivo usa sem puxar o ticket.
// Cada aparelho tem um palpite só: palpitar de novo ajusta o mesmo (a API troca os números, o id e o card ficam).
import type { Board, Guess } from '@apuracao/shared';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

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

/** o palpite deste aparelho (null enquanto carrega ou se não há); recarrega quando `key` muda */
export function useMyGuess(key = 0): Guess | null {
  const id = myGuessId();
  const [g, setG] = useState<Guess | null>(null);
  useEffect(() => {
    if (!id) return setG(null);
    let alive = true;
    api
      .guess(id)
      .then((v) => alive && setG(v.guess))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [id, key]);
  return g;
}
