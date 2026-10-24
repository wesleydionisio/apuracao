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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
