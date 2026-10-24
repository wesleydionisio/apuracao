import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

// só em dev: os stores no console, para forçar estados (carregando, vazio, offline) e medir layout shift
if (import.meta.env.DEV) {
  void Promise.all([import('./store/board'), import('./store/chat')]).then(([b, c]) => {
    Object.assign(window, { __board: b.useBoard, __chat: c.useChat });
  });
  if (document.cookie.includes('shiftlog=1')) void import('./dev/shiftlog');
}

// deploy no meio da visita: a CDN ainda serve o HTML antigo por até ~1 min e um chunk dele pode não existir mais.
// Recarrega uma vez para pegar a versão nova (no máximo uma vez a cada 30 s, para nunca virar laço)
window.addEventListener('vite:preloadError', (e) => {
  try {
    const last = Number(sessionStorage.getItem('reloadAt') ?? 0);
    if (Date.now() - last < 30_000) return;
    sessionStorage.setItem('reloadAt', String(Date.now()));
  } catch {
    return;
  }
  e.preventDefault();
  location.reload();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
