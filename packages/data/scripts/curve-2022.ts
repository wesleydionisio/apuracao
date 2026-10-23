// Curva da noite do 2º turno de 2022 (eixo = % de seções apuradas, % dos válidos de 13 e 22).
// O TSE não publica a série temporal: isto é uma RECONSTRUÇÃO APROXIMADA. Pontos marcados `src: 'fonte'`
// vêm de reportagens/TSE (ver `note`); os demais são interpolação coerente com a ordem de chegada
// (Sul/Sudeste primeiro, Nordeste depois) e devem ser exibidos como tal.
import { join } from 'node:path';
import { isMain, STATIC, writeJson } from './lib';

type P = { pst: number; lula: number; src: 'fonte' | 'interp' };

const POINTS: P[] = [
  { pst: 0.3, lula: 50.6, src: 'interp' }, // Lula liderou só nos primeiros 7 minutos (A Gazeta)
  { pst: 2, lula: 43.5, src: 'interp' }, // vantagem inicial de Bolsonaro chegou a ~14 pontos (Diario de Cuyo)
  { pst: 5, lula: 45.0, src: 'interp' },
  { pst: 10, lula: 46.4, src: 'interp' },
  { pst: 20, lula: 47.6, src: 'interp' },
  { pst: 30, lula: 48.4, src: 'interp' },
  { pst: 40, lula: 49.0, src: 'interp' }, // "Bolsonaro lidera com 40% das urnas apuradas, mas Lula se aproxima" (Revista Oeste)
  { pst: 45, lula: 49.6, src: 'interp' }, // "Mais de 45% das urnas apuradas: diferença de menos de 1%" (Correio Braziliense)
  { pst: 50, lula: 49.7, src: 'interp' }, // "TSE apura metade das urnas; tecnicamente empatados" (Correio Braziliense)
  { pst: 60, lula: 49.9, src: 'interp' },
  { pst: 67.76, lula: 50.01, src: 'fonte' }, // virada às 18h44 com 67,76% (A Gazeta); 50,01% (Correio Braziliense, "66%")
  { pst: 75, lula: 50.3, src: 'interp' },
  { pst: 85, lula: 50.55, src: 'interp' },
  { pst: 92, lula: 50.7, src: 'interp' },
  { pst: 98.45, lula: 50.8, src: 'fonte' }, // BP Money
  { pst: 98.91, lula: 50.83, src: 'fonte' }, // TSE: Lula eleito com 98,91% (59.563.912 × 57.675.427)
  { pst: 100, lula: 50.9, src: 'fonte' }, // totalização final: 60.345.999 × 58.206.354
];

export function buildCurve2022() {
  const out = {
    label: '2º turno 2022 (reconstrução aproximada)',
    note:
      'Reconstrução aproximada: o TSE não publica a série da noite. Pontos "fonte": virada com 67,76% às 18h44 ' +
      '(A Gazeta; Correio Braziliense registrou Lula 50,01%), 98,45% → 50,80% (BP Money), 98,91% → 50,83% ' +
      '(TSE, "Lula é eleito novamente"), final 50,90% × 49,10% (TSE). Demais pontos interpolados a partir de ' +
      'relatos qualitativos (Lula à frente nos primeiros 7 min; vantagem inicial de Bolsonaro de até ~14 pontos; ' +
      'diferença < 1 ponto com 45%; empate técnico com 50%).',
    points: POINTS.map((p) => ({
      pst: p.pst,
      pct: { '13': p.lula, '22': Math.round((100 - p.lula) * 100) / 100 },
      src: p.src,
    })),
  };
  writeJson(join(STATIC, 'curve-2022.json'), out);
  console.log(`curve-2022.json: ${out.points.length} pontos (${POINTS.filter((p) => p.src === 'fonte').length} de fonte)`);
}

if (isMain(import.meta.url)) buildCurve2022();
