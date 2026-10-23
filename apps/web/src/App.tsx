import { lazy, Suspense, useEffect, useRef } from 'react';
import { Route, Switch, useLocation } from 'wouter';
import { Header, TabBar } from './components/chrome';
import { Skeleton, Toaster } from './components/ui';
import { api, fetchBoard } from './lib/api';
import { live } from './lib/live';
import Home from './pages/Home';
import { useBoard } from './store/board';

const MapPage = lazy(() => import('./pages/MapPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
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
  useEffect(() => {
    if (!path.startsWith('/chat') && !path.startsWith('/sala')) window.scrollTo(0, 0);
  }, [path]);
  return (
    <>
      <div ref={headerRef} className="fixed inset-x-0 top-0 z-30">
        <Header />
      </div>
      <main className="pb-tabbar mx-auto max-w-3xl lg:max-w-5xl px-3" style={{ paddingTop: 'calc(var(--header-total, 120px) + 12px)' }}>
        <Suspense fallback={<Skeleton h={240} />}>
          <Switch>
            <Route path="/" component={Home} />
            <Route path="/mapa" component={MapPage} />
            <Route path="/mapa/:uf" component={MapPage} />
            <Route path="/chat" component={ChatPage} />
            <Route path="/sala/:slug" component={SalaPage} />
            <Route path="/cidade" component={CityPage} />
            <Route path="/cidade/:uf/:slug" component={CityPage} />
            <Route path="/palpite" component={PalpitePage} />
            <Route path="/p/:id" component={GuessPage} />
            <Route path="/m/:id" component={MomentPage} />
            <Route>
              <p className="py-10 text-center text-muted">Página não encontrada.</p>
            </Route>
          </Switch>
        </Suspense>
      </main>
      <TabBar />
      <Toaster />
    </>
  );
}

export default function App() {
  const [path] = useLocation();
  useBoardPolling();
  useIdentityAndStats();
  const standalone = path === '/tv' || path.startsWith('/embed');
  useEffect(() => {
    // TV e embed não precisam de chat; o placar vem pelo polling
    if (!path.startsWith('/embed')) live.start();
  }, [path]);
  if (standalone)
    return (
      <Suspense fallback={null}>
        <Switch>
          <Route path="/tv" component={TvPage} />
          <Route path="/embed/placar" component={EmbedPage} />
        </Switch>
      </Suspense>
    );
  return <Frame />;
}
