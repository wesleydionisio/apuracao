import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { Route, Router, Switch, useLocation } from 'wouter';
import { useCandidateCssVars } from '@/components/core/candidate';
import { Header, headerMini, MINI_H } from '@/components/shell/Header';
import { CookieBanner } from '@/components/shell/CookieBanner';
import { TabBar } from '@/components/shell/TabBar';
import { Toaster } from './components/ui';
import { CityDetailSkeleton, CitySearchSkeleton, GuessSkeleton, MapSkeleton, MomentSkeleton, PainelSkeleton, TextSkeleton } from './components/skeletons';
import { lastReleased } from './lib/ghost';
import { aroundNav, pages } from './lib/nav';
import { api, fetchBoard } from './lib/api';
import { live, savedSide } from './lib/live';
import { startSite } from './lib/site';
import ChatPage, { SalaPage } from './pages/ChatPage';
import Home from './pages/Home';
import { useBoard } from './store/board';

const Painel = lazy(pages.painel);
const MapPage = lazy(pages.mapa);
const CityPage = lazy(pages.cidade);
const GuessPage = lazy(pages.palpite);
const PalpitePage = lazy(() => pages.palpite().then((m) => ({ default: m.PalpitePage })));
const PrivacyPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.TermsPage })));
const MomentPage = lazy(() => import('./pages/Standalone').then((m) => ({ default: m.MomentPage })));
const TvPage = lazy(() => import('./pages/Standalone').then((m) => ({ default: m.TvPage })));
const EmbedPage = lazy(() => import('./pages/Standalone').then((m) => ({ default: m.EmbedPage })));
const AdminPage = lazy(() => import('./pages/Admin'));

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
        // o "hello" do WS é a fonte da verdade (lado, conta do Google): se já chegou, não sobrescreve
        if (useBoard.getState().me) return;
        let nick: string | null = null;
        try {
          nick = localStorage.getItem('nick');
        } catch {
          /* sem storage */
        }
        useBoard.getState().set({ me: { ...me, nick: nick ?? me.nick, side: savedSide() } });
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
  const mini = headerMini(path);
  // antes do quadro novo (a transição de tela fotografa a página já no topo)
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [path]);
  return (
    <>
      <div ref={headerRef} className="fixed inset-x-0 top-0 z-30">
        <Header />
      </div>
      <main
        className="pb-tabbar mx-auto max-w-3xl px-4 lg:max-w-6xl"
        style={{ paddingTop: `calc(var(--header-total, 64px) + ${mini === 'pinned' ? MINI_H : 0}px + var(--page-top))` }}
      >
        {/* a página ocupa ao menos a tela, mesmo enquanto o conteúdo carrega */}
        <div style={{ minHeight: `calc(100dvh - var(--header-total, 64px) - ${mini === 'pinned' ? MINI_H : 0}px - var(--page-top))` }}>
          <Suspense fallback={<PageFallback path={path} />}>
            <Switch>
              <Route path="/" component={Home} />
              <Route path="/painel" component={Painel} />
              <Route path="/mapa" component={MapPage} />
              <Route path="/mapa/:uf" component={MapPage} />
              <Route path="/chat" component={ChatPage} />
              <Route path="/sala/:slug" component={SalaPage} />
              <Route path="/cidade" component={CityPage} />
              <Route path="/cidade/:uf/:slug" component={CityPage} />
              <Route path="/palpite" component={PalpitePage} />
              <Route path="/p/:id" component={GuessPage} />
              <Route path="/m/:id" component={MomentPage} />
              <Route path="/privacidade" component={PrivacyPage} />
              <Route path="/termos" component={TermsPage} />
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
        </div>
      </main>
      <TabBar />
      <CookieBanner />
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

/** enquanto o código da tela carrega: o esqueleto dela, o mesmo que a tela mostra enquanto o placar não chega */
function PageFallback({ path }: { path: string }) {
  if (path.startsWith('/painel')) return <PainelSkeleton />;
  if (path.startsWith('/mapa')) return <MapSkeleton />;
  if (path === '/cidade') return <CitySearchSkeleton />;
  if (path.startsWith('/cidade/')) return <CityDetailSkeleton />;
  if (path.startsWith('/palpite') || path.startsWith('/p/')) return <GuessSkeleton released={lastReleased()} />;
  if (path.startsWith('/m/')) return <MomentSkeleton />;
  return <TextSkeleton />;
}

// barra de debug da simulação: só existe em `vite dev` (removida do build de produção)
const DevBar = import.meta.env.DEV ? lazy(() => import('./dev/DevBar')) : null;

function Screens() {
  const [path] = useLocation();
  useBoardPolling();
  useIdentityAndStats();
  useCandidateCssVars();
  const admin = path.startsWith('/admin');
  const standalone = path === '/tv' || path.startsWith('/embed') || admin;
  useEffect(() => {
    // TV e embed não precisam de chat; o placar vem pelo polling. O admin não conta como gente online
    if (!path.startsWith('/embed') && !admin) live.start();
    if (!path.startsWith('/embed')) startSite();
  }, [path, admin]);
  const dev = DevBar && !path.startsWith('/embed') && !admin && (
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
          <Route path="/admin" component={AdminPage} />
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

export default function App() {
  return (
    <Router aroundNav={aroundNav}>
      <Screens />
    </Router>
  );
}
