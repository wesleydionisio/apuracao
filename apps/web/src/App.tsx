import { lazy, Suspense, useEffect, useRef } from 'react';
import { Redirect, Route, Switch, useLocation } from 'wouter';
import { useCandidateCssVars } from '@/components/core/candidate';
import { LegalFooter } from '@/components/shell/bits';
import { Header } from '@/components/shell/Header';
import { TabBar } from '@/components/shell/TabBar';
import { Skeleton, Toaster } from './components/ui';
import { api, fetchBoard } from './lib/api';
import { live } from './lib/live';
import Home from './pages/Home';
import { useBoard } from './store/board';

const Painel = lazy(() => import('./pages/Painel'));
const MapPage = lazy(() => import('./pages/MapPage'));
const SalaPage = lazy(() => import('./pages/ChatPage').then((m) => ({ default: m.SalaPage })));
const CityPage = lazy(() => import('./pages/CityPage'));
const GuessPage = lazy(() => import('./pages/GuessPage'));
const PalpitePage = lazy(() => import('./pages/GuessPage').then((m) => ({ default: m.PalpitePage })));
const MomentPage = lazy(() => import('./pages/Standalone').then((m) => ({ default: m.MomentPage })));
const TvPage = lazy(() => import('./pages/Standalone').then((m) => ({ default: m.TvPage })));
const EmbedPage = lazy(() => import('./pages/Standalone').then((m) => ({ default: m.EmbedPage })));

/** placar: polling do JSON estático (10s sem WS, 30s com WS) */
function useBoardPolling() {
  const link = useBoard((s) => s.link);
  useEffect(() => {
    let alive = true;
    let t: ReturnType<typeof setTimeout>;
    const every = link === 'live' ? 30_000 : 10_000;
    const tick = async () => {
      try {
        const b = await fetchBoard();
        if (alive) useBoard.getState().setBoard(b);
      } catch {
        if (alive && !useBoard.getState().board) useBoard.getState().set({ loadError: true });
      }
      if (alive) t = setTimeout(tick, document.visibilityState === 'hidden' ? every * 3 : every);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [link]);
}

function useIdentityAndStats() {
  useEffect(() => {
    api
      .me()
      .then((me) => {
        let nick: string | null = null;
        try {
          nick = localStorage.getItem('nick');
        } catch {
          /* sem storage */
        }
        useBoard.getState().set({ me: nick ? { ...me, nick } : me });
        if (nick && nick !== me.nick) live.nick(nick);
      })
      .catch(() => {});
    const load = () =>
      api
        .stats()
        .then((stats) => useBoard.getState().set({ stats }))
        .catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
}

/** Altura real visível (teclado virtual) e altura do cabeçalho em variáveis CSS. */
function useViewportVars(headerRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const update = () => {
      const h = vv?.height ?? window.innerHeight;
      root.style.setProperty('--vvh', `${h}px`);
      root.style.setProperty('--vvtop', `${vv?.offsetTop ?? 0}px`);
      // teclado aberto: a área visível encolhe bastante
      root.classList.toggle('kb', window.innerHeight - h > 120);
    };
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    const el = headerRef.current;
    const ro = el ? new ResizeObserver(() => root.style.setProperty('--header-total', `${el.offsetHeight}px`)) : null;
    if (el && ro) ro.observe(el);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      ro?.disconnect();
    };
  }, [headerRef]);
}

function Frame() {
  const headerRef = useRef<HTMLDivElement>(null);
  const [path] = useLocation();
  useViewportVars(headerRef);
  const liveScreen = path === '/' || path.startsWith('/sala');
  useEffect(() => {
    if (!liveScreen) window.scrollTo(0, 0);
  }, [path, liveScreen]);
  return (
    <>
      <div ref={headerRef} className="fixed inset-x-0 top-0 z-30">
        <Header />
      </div>
      <main className="pb-tabbar mx-auto max-w-3xl px-4 lg:max-w-6xl" style={{ paddingTop: 'calc(var(--header-total, 64px) + 12px)' }}>
        <Suspense fallback={<PageFallback />}>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/painel" component={Painel} />
            <Route path="/mapa" component={MapPage} />
            <Route path="/mapa/:uf" component={MapPage} />
            <Route path="/chat">
              <Redirect to="/" replace />
            </Route>
            <Route path="/sala/:slug" component={SalaPage} />
            <Route path="/cidade" component={CityPage} />
            <Route path="/cidade/:uf/:slug" component={CityPage} />
            <Route path="/palpite" component={PalpitePage} />
            <Route path="/p/:id" component={GuessPage} />
            <Route path="/m/:id" component={MomentPage} />
            <Route>
              <div className="py-16 text-center">
                <p className="text-[15px] font-semibold">Página não encontrada</p>
                <a href="/" className="mt-2 inline-flex min-h-11 items-center text-[14px] text-muted-foreground underline underline-offset-4">
                  Voltar ao placar
                </a>
              </div>
            </Route>
          </Switch>
        </Suspense>
        {/* aviso legal em toda tela; a tela Ao vivo (placar + chat) mostra o seu dentro do layout */}
        {!liveScreen && <LegalFooter />}
      </main>
      <TabBar />
      <Suspense fallback={null}>
        <Toaster
          position="bottom-center"
          offset={{ bottom: 'calc(var(--tabbar-total) + 12px)' }}
          mobileOffset={{ bottom: 'calc(var(--tabbar-total) + 12px)', left: '16px', right: '16px' }}
        />
      </Suspense>
    </>
  );
}

function PageFallback() {
  return (
    <div className="space-y-4 pt-2" aria-busy="true">
      <Skeleton h={28} className="w-48" />
      <Skeleton h={220} />
      <Skeleton h={120} />
    </div>
  );
}

// barra de debug da simulação: só existe em `vite dev` (removida do build de produção)
const DevBar = import.meta.env.DEV ? lazy(() => import('./dev/DevBar')) : null;

export default function App() {
  const [path] = useLocation();
  useBoardPolling();
  useIdentityAndStats();
  useCandidateCssVars();
  const standalone = path === '/tv' || path.startsWith('/embed');
  useEffect(() => {
    // TV e embed não precisam de chat; o placar vem pelo polling
    if (!path.startsWith('/embed')) live.start();
  }, [path]);
  const dev = DevBar && !path.startsWith('/embed') && (
    <Suspense fallback={null}>
      <DevBar />
    </Suspense>
  );
  if (standalone)
    return (
      <Suspense fallback={null}>
        {dev}
        <Switch>
          <Route path="/tv" component={TvPage} />
          <Route path="/embed/placar" component={EmbedPage} />
        </Switch>
      </Suspense>
    );
  return (
    <>
      {dev}
      <Frame />
    </>
  );
}
