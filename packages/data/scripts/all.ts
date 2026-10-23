// Roda o ETL inteiro em ordem. Idempotente: downloads ficam em packages/data/raw/.
import { buildCurve2022 } from './curve-2022';
import { buildFonts } from './fonts';
import { buildGeo } from './geo';
import { buildPhotos } from './photos';
import { buildT1 } from './t1-2026';
import { buildY2022 } from './y2022';

const t0 = Date.now();
const step = async (name: string, fn: () => unknown) => {
  const t = Date.now();
  console.log(`\n▶ ${name}`);
  await fn();
  console.log(`  ${name}: ${((Date.now() - t) / 1000).toFixed(1)}s`);
};

await step('1º turno 2026 + municípios', buildT1);
await step('2022', buildY2022);
await step('geo', buildGeo);
await step('fontes', buildFonts);
await step('fotos dos candidatos', buildPhotos);
await step('curva 2022', buildCurve2022);
console.log(`\nETL completo em ${((Date.now() - t0) / 1000).toFixed(0)}s`);
