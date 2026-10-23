// Gera os cards PNG com dados de exemplo em var/og-preview/ (sem subir a API).
//   cd apps/api && node_modules/.bin/tsx scripts/og-preview.ts
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Board } from '@apuracao/shared';
import { config } from '../src/config';
import { guessCard, scoreCard } from '../src/og';

const out = path.join(config.varDir, 'og-preview');
mkdirSync(out, { recursive: true });
const board = JSON.parse(readFileSync(path.join(config.dataDir, 'br.json'), 'utf8')) as Board;
const cands = board.candidates;
const save = (name: string, png: Buffer) => {
  writeFileSync(path.join(out, name), png);
  console.log(`${name} ${Math.round(png.length / 1024)} KB`);
};

const t = Date.now();
save('guess-story.png', await guessCard('story', { nick: 'Capivara Atenta 12', pa: 48.6, cands }));
save('guess-og.png', await guessCard('og', { nick: 'Capivara Atenta 12', pa: 48.6, cands }));
save('guess-result-story.png', await guessCard('story', { nick: 'Capivara Atenta 12', pa: 48.6, cands, result: { pa: 48.92, dist: 0.32, rank: 1834, total: 131977 } }));
save('guess-result-og.png', await guessCard('og', { nick: 'Capivara Atenta 12', pa: 48.6, cands, result: { pa: 48.92, dist: 0.32, rank: 1834, total: 131977 } }));
save('board.png', await scoreCard({ title: 'Apuração do 2º turno ao vivo', snap: board.br, cands, at: board.source.at }));
save('board-pre.png', await scoreCard({ title: 'Apuração do 2º turno ao vivo a partir das 17h', snap: null, cands }));
const m = board.moments[0];
if (m) save('moment.png', await scoreCard({ title: m.title, snap: board.br, cands, at: m.at }));
save('city.png', await scoreCard({ title: 'Campinas (SP)', snap: board.ufs['uf:SP'] ?? board.br, cands, at: board.source.at }));
save('city-pre.png', await scoreCard({ title: 'Campinas (SP)', snap: null, cands, subtitle: '1º turno: Lula 42,3% · Flavio Bolsonaro 57,7%' }));
console.log(`${Date.now() - t} ms`);
