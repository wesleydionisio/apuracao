// Navegação entre telas: código das telas carregado sob demanda (com pré-carga na intenção) e
// transição suave via View Transitions API, quando o navegador tem e o usuário não pediu menos movimento.
import { flushSync } from 'react-dom';
import type { AroundNavHandler } from 'wouter';

/** carregadores das telas preguiçosas: os mesmos para o lazy() do App e para a pré-carga */
export const pages = {
  painel: () => import('../pages/Painel'),
  mapa: () => import('../pages/MapPage'),
  cidade: () => import('../pages/CityPage'),
  palpite: () => import('../pages/GuessPage'),
};

const byPath: [prefix: string, load: () => Promise<unknown>][] = [
  ['/painel', pages.painel],
  ['/mapa', pages.mapa],
  ['/cidade', pages.cidade],
  ['/palpite', pages.palpite],
];

const started = new Set<string>();

/** dedo ou mouse em cima de um link: já busca o código da tela (uma vez só) */
export function prefetchPage(path: string) {
  const hit = byPath.find(([p]) => path.startsWith(p));
  if (!hit || started.has(hit[0])) return;
  started.add(hit[0]);
  hit[1]().catch(() => started.delete(hit[0]));
}

const reduce = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** cada navegação vira uma transição de tela (cross-fade curto); sem suporte ou com menos movimento, troca direto */
export const aroundNav: AroundNavHandler = (navigate, to, options) => {
  if (!document.startViewTransition || reduce() || document.visibilityState !== 'visible') return navigate(to, options);
  document.startViewTransition(() => flushSync(() => navigate(to, options)));
};
