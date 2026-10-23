import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const API = process.env.API_URL ?? 'http://localhost:3001';
const WS = process.env.WS_URL ?? 'ws://localhost:3002';
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(__dirname, '../../public/data'));

// Rotas HTML compartilháveis vão para a API (que injeta as metas OG).
// Em modo mock (?mock=1) ou com WEB_ONLY=1 o próprio Vite serve o SPA.
const htmlBypass = (req: IncomingMessage) => {
  const wantsHtml = (req.headers.accept ?? '').includes('text/html');
  if (wantsHtml && (process.env.WEB_ONLY || (req.url ?? '').includes('mock=1'))) return '/index.html';
  return undefined;
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
    },
  },
  build: {
    target: 'es2020',
    sourcemap: false,
  },
});
