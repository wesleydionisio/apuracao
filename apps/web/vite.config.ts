import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const API = process.env.API_URL ?? 'http://localhost:3001';
const WS = process.env.WS_URL ?? 'ws://localhost:3002';
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(__dirname, '../../public/data'));

// Em produção as rotas compartilháveis vêm da API (HTML do build + metas OG).
// Em dev, navegador fica com o Vite (o index.html cru da API não tem o preâmbulo do Vite);
// requisições sem Accept: text/html (curl, crawlers de teste) ainda vão para a API ver as metas.
const htmlBypass = (req: IncomingMessage) => {
  const wantsHtml = (req.headers.accept ?? '').includes('text/html');
  return wantsHtml ? '/index.html' : undefined;
};

const html = { target: API, changeOrigin: true, bypass: htmlBypass };

/** Em dev, serve /data/* direto de public/data (poller/ETL) se o arquivo existir; senão cai no proxy da API. */
function localData(): Plugin {
  return {
    name: 'local-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/data/')) return next();
        const file = normalize(join(DATA_DIR, decodeURIComponent(url.slice(6))));
        if (!file.startsWith(DATA_DIR) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.setHeader('cache-control', 'no-cache');
        createReadStream(file).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localData()],
  resolve: { alias: { '@': resolve(__dirname, 'src') } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: API, changeOrigin: true },
      '/data': { target: API, changeOrigin: true },
      '/p/': html,
      '/m/': html,
      '/cidade/': html,
      '/sala/': html,
      '/ws': { target: WS, ws: true, changeOrigin: true },
      // controles da simulação (poller em SOURCE=replay) para a barra de debug
      '/__dev': { target: process.env.POLLER_URL ?? 'http://localhost:3003', changeOrigin: true, rewrite: (p) => p.replace(/^\/__dev/, '/dev') },
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
