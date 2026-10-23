// Referências históricas do placar nacional: 1º turno 2026 (A×B) e 2º turno 2022 (mesmos partidos).
import type { Board } from '@apuracao/shared';
import { twoWay } from '@apuracao/shared';
import { useEffect, useState } from 'react';
import { staticData } from '@/lib/api';

export interface HistRefs {
  /** % de A no confronto A×B do 1º turno 2026 */
  t1: number | null;
  /** % de A no 2º turno de 2022 (pelo mapeamento de números do Board) */
  y22: number | null;
}

export function useHistRefs(board: Board | null): HistRefs {
  const [r, setR] = useState<HistRefs>({ t1: null, y22: null });
  const cands = board?.candidates;
  const map = board?.y2022Map;
  useEffect(() => {
    if (!cands || cands.length < 2) return;
    let alive = true;
    Promise.all([staticData.hist('t1-2026').catch(() => null), staticData.hist('y2022-t2').catch(() => null)]).then(([t1, y22]) => {
      if (!alive) return;
      let p22: number | null = null;
      const row = y22?.br;
      if (row && map) {
        const a = row.votes[map.a] ?? 0;
        const b = row.votes[map.b] ?? 0;
        p22 = a + b ? Math.round((a / (a + b)) * 10000) / 100 : null;
      }
      setR({ t1: twoWay(t1?.br, cands), y22: p22 });
    });
    return () => {
      alive = false;
    };
  }, [cands?.[0]?.n, cands?.[1]?.n, map?.a, map?.b]);
  return r;
}

/**
 * Virada de 2022: último cruzamento das linhas. Se o ponto logo depois da troca vem de fonte
 * (67,76% às 18h44), usa ele; senão interpola entre as duas amostras.
 */
export function flipOf(pts: { pst: number; pa: number; src?: string }[] | null): { pst: number; lead: 'a' | 'b' } | null {
  if (!pts) return null;
  let flip: { pst: number; lead: 'a' | 'b' } | null = null;
  for (let i = 1; i < pts.length; i++) {
    const d0 = pts[i - 1].pa - 50;
    const d1 = pts[i].pa - 50;
    if (d0 === 0 || Math.sign(d0) === Math.sign(d1)) continue;
    const pst = pts[i].src === 'fonte' ? pts[i].pst : pts[i - 1].pst + ((pts[i].pst - pts[i - 1].pst) * Math.abs(d0)) / (Math.abs(d0) + Math.abs(d1));
    flip = { pst, lead: d1 > 0 ? 'a' : 'b' };
  }
  return flip;
}

/** curva de 2022 em % de A por % apurado (reconstrução) */
export function useCurve22(board: Board | null, enabled: boolean) {
  const [pts, setPts] = useState<{ pst: number; pa: number; src?: string }[] | null>(null);
  const map = board?.y2022Map;
  useEffect(() => {
    if (!enabled || !map || pts) return;
    let alive = true;
    staticData
      .curve2022()
      .then((c) => {
        if (!alive || !c) return;
        setPts(
          c.points
            .map((p) => {
              const a = p.pct[map.a];
              const b = p.pct[map.b];
              const pa = a !== undefined && b !== undefined ? (a / (a + b)) * 100 : a;
              return { pst: p.pst, pa, src: (p as { src?: string }).src };
            })
            .filter((p) => Number.isFinite(p.pa)) as { pst: number; pa: number; src?: string }[],
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [enabled, map?.a, map?.b, pts]);
  return pts;
}
