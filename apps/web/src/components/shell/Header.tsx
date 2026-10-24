// Cabeçalho compacto (estilo Polymarket): marca + ao vivo + tema; mini-placar quando o herói sai da tela.
// Tudo no topo usa o mesmo vidro fosco da barra de abas.
import type { Board } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { Moon, Sun } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { LivePill } from '@/components/core/live';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { useNow } from '../ui';
import { fmtCountdown, Logo, SplitBar } from './bits';
import { SponsorStrip } from './SponsorStrip';
import { setTheme, useIsDark } from './theme';

const PCT = { minimumFractionDigits: 1, maximumFractionDigits: 1 } as const;

function ThemeToggle() {
  const dark = useIsDark();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-11 rounded-full text-muted-foreground hover:text-foreground"
      aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      {dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </Button>
  );
}

/**
 * Onde o mini-placar aparece. Ele flutua sob a barra do cabeçalho e nunca muda a altura dela:
 * - "none": Ao vivo e Chat já mostram o placar;
 * - "hero": Painel, desliza por cima só quando o placar grande sai da tela;
 * - "pinned": demais telas, sempre visível, com o espaço reservado desde o primeiro quadro (skeleton até o dado chegar).
 */
export function headerMini(path: string): 'none' | 'hero' | 'pinned' {
  if (path === '/' || path.startsWith('/sala') || path === '/chat') return 'none';
  return path.startsWith('/painel') ? 'hero' : 'pinned';
}

/** altura da faixa do mini-placar (px): reservada no topo das telas "pinned" */
export const MINI_H = 58;

/** o mesmo vidro fosco da barra de abas: cabeçalho, faixa de patrocínio e mini-placar leem como uma peça só */
const FROST = 'bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75';

export function Header() {
  const board = useBoard((s) => s.board);
  const link = useBoard((s) => s.link);
  const hero = useBoard((s) => s.heroVisible);
  const [path] = useLocation();
  const live = !!board?.released && !!board.br;
  const mini = headerMini(path);
  // Painel antes das 17h: a contagem já é o topo da página; o mini (só a contagem de novo) ficaria por cima dela
  const show = mini === 'pinned' || (mini === 'hero' && live && !hero);
  return (
    <>
      {/*
        O vidro precisa estar no próprio elemento que tem o view-transition-name: um ancestral com esse nome vira
        "backdrop root" e o desfoque dos filhos só enxerga o próprio cabeçalho, não a página por trás (por isso o
        contêiner fixo do App não tem nome). Cabeçalho e mini-placar são irmãos, cada um com o seu vidro e o seu nome.
      */}
      <header className={cn('safe-t relative border-b [view-transition-name:app-header]', FROST)}>
        <SponsorStrip />
        <div className="mx-auto max-w-3xl px-4 lg:max-w-6xl">
          <div className="flex h-13 items-center gap-2">
            <Link href="/" className="flex min-w-0 flex-1 items-center gap-2.5" aria-label="urna.digi, início">
              <Logo className="text-[19px]" />
              {/* rótulo seco: caixa alta pequena, separada por um fio, sem pílula */}
              <span className="hidden border-l pl-2.5 text-[10.5px] leading-none font-semibold tracking-[0.14em] text-muted-foreground uppercase min-[340px]:inline">
                2º turno
              </span>
            </Link>
            <LivePill link={link} className="shrink-0" />
            <ThemeToggle />
          </div>
        </div>
      </header>
      {mini !== 'none' && (
        <div
          className={cn(
            'absolute inset-x-0 top-full border-b transition-[opacity,translate] duration-200 ease-out [view-transition-name:app-mini]',
            FROST,
            show ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-1 opacity-0',
          )}
          aria-hidden={!show}
          ref={(el) => {
            if (el) el.inert = !show;
          }}
        >
          <div className="mx-auto flex max-w-3xl flex-col justify-center px-4 py-1.5 lg:max-w-6xl" style={{ height: MINI_H }}>
            {!board ? <MiniSkeleton /> : live ? <MiniScore board={board} /> : <MiniCountdown board={board} />}
          </div>
        </div>
      )}
    </>
  );
}

function MiniSkeleton() {
  return (
    <div aria-busy="true" aria-label="Carregando placar">
      <div className="flex h-[26px] items-center gap-2">
        <span className="size-6 shrink-0 animate-pulse rounded-md bg-muted" />
        <span className="h-4 w-[3.6rem] animate-pulse rounded bg-muted" />
        <span className="h-1.5 flex-1 rounded-full bg-muted" />
        <span className="h-4 w-[3.6rem] animate-pulse rounded bg-muted" />
        <span className="size-6 shrink-0 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="mt-1 flex h-4 items-center justify-between">
        <span className="h-2.5 w-36 animate-pulse rounded bg-muted" />
        <span className="h-2.5 w-20 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

/** Placar de bolso: avatares, %, barra com 50% e o quanto já foi apurado */
function MiniScore({ board }: { board: Board }) {
  const br = board.br!;
  const [ca, cb] = board.candidates;
  return (
    <Link href="/" className="block" aria-label="Ver placar ao vivo">
      <div className="flex h-[26px] items-center gap-2">
        <CandidateAvatar c={ca} size="xs" ring={br.lead === 'a'} />
        <span className="display min-w-[3.6rem] text-[17px] font-semibold" style={{ color: ca.color }}>
          <NumberFlow value={br.pa} format={PCT} locales="pt-BR" suffix="%" />
        </span>
        <SplitBar b={board} h={6} className="flex-1" />
        <span className="display min-w-[3.6rem] text-right text-[17px] font-semibold" style={{ color: cb.color }}>
          <NumberFlow value={br.pb} format={PCT} locales="pt-BR" suffix="%" />
        </span>
        <CandidateAvatar c={cb} size="xs" ring={br.lead === 'b'} />
      </div>
      <div className="mt-1 flex h-4 items-center justify-center text-[11px] text-muted-foreground">
        <span className="num">
          <span className="font-medium text-foreground">{br.pst.toLocaleString('pt-BR', PCT)}%</span> das urnas apuradas
        </span>
      </div>
    </Link>
  );
}

export function MiniCountdown({ board }: { board: Board }) {
  const now = useNow(1000);
  const left = Date.parse(board.releaseAt) - now;
  return (
    <Link
      href="/"
      className="flex h-[46px] items-center justify-center text-[11.5px] font-medium tracking-[0.08em] text-foreground/75 uppercase"
    >
      <span>
        Placar abre em{' '}
        <span className="num font-bold tracking-[0.04em] text-foreground">{left > 0 ? fmtCountdown(left) : 'instantes'}</span>
      </span>
    </Link>
  );
}
