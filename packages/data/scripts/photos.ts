// Fotos oficiais dos candidatos do 2º turno, direto do TSE (mesma fonte dos resultados).
// Saída: apps/web/public/cand/<número>.jpg — o poller anuncia o caminho no Board quando o arquivo existe.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseResult } from '@apuracao/shared';
import { ensureDir, isMain, ROOT, UA } from './lib';

const BASE = 'https://resultados.tse.jus.br/oficial/ele2026/6258';
export const PHOTOS = join(ROOT, 'apps/web/public/cand');

export async function buildPhotos() {
  const res = await fetch(`${BASE}/dados/br/br-c0001-e006258-u.json`, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`TSE ${res.status}`);
  const br = parseResult(await res.json());
  ensureDir(PHOTOS);
  for (const [n, c] of Object.entries(br.names)) {
    const out = join(PHOTOS, `${n}.jpg`);
    if (existsSync(out) || !c.sq) continue;
    const img = await fetch(`${BASE}/fotos/br/${c.sq}.jpeg`, { headers: { 'user-agent': UA } });
    if (!img.ok) {
      console.warn(`  foto ${n} (${c.name}): HTTP ${img.status}`);
      continue;
    }
    writeFileSync(out, Buffer.from(await img.arrayBuffer()));
    console.log(`  ${n} ${c.name} → ${out}`);
  }
}

if (isMain(import.meta.url)) await buildPhotos();
