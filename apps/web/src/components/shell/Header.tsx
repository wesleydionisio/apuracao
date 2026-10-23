// Cabeçalho compacto (estilo Polymarket): marca + ao vivo + tema; mini-placar quando o herói sai da tela.
import type { Board } from '@apuracao/shared';
import NumberFlow from '@number-flow/react';
import { Moon, Sun } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { LivePill, SourceStamp } from '@/components/core/live';
import { Button } from '@/components/ui/button';
import { useBoard } from '@/store/board';
import { useNow } from '../ui';
import { fmtCountdown, Logo, SplitBar } from './bits';
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

export function Header() {
  const board = useBoard((s) => s.board);
  const link = useBoard((s) => s.link);
  const hero = useBoard((s) => s.heroVisible);
  const [path] = useLocation();
  const live = !!board?.released && !!board.br;
  // na tela Ao vivo o placar já está na tela: nada de mini-placar no cabeçalho
  const liveScreen = path === '/' || path.startsWith('/sala');
  return (
    <header className="safe-t border-b bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto max-w-3xl px-4 lg:max-w-6xl">
        <div className="flex h-13 items-center gap-2">
          <Link href="/" className="flex min-w-0 flex-1 items-center gap-2" aria-label="Apuração ao vivo — início">
            <Logo />
            <span className="truncate text-[16px] font-semibold tracking-[-0.02em]">Apuração</span>
            <span className="hidden text-[13px] text-muted-foreground min-[380px]:inline">2º turno 2026</span>
          </Link>
          <LivePill link={link} className="shrink-0" />
          <ThemeToggle />
        </div>
        {board && !hero && !liveScreen && (live ? <MiniScore board={board} /> : <MiniCountdown board={board} />)}
      </div>
    </header>
  );
}

/** Placar de bolso: avatares, %, barra com 50% e procedência */
function MiniScore({ board }: { board: Board }) {
  const br = board.br!;
  const [ca, cb] = board.candidates;
  return (
    <Link href="/" className="block pb-2.5" aria-label="Ver placar ao vivo">
      <div className="flex items-center gap-2">
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
      <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="num">
          <span className="font-medium text-foreground">{br.pst.toLocaleString('pt-BR', PCT)}%</span> das urnas apuradas
        </span>
        <SourceStamp at={board.source.at} className="text-[11px]" short />
      </div>
    </Link>
  );
}

function MiniCountdown({ board }: { board: Board }) {
  const now = useNow(1000);
  const left = Date.parse(board.releaseAt) - now;
  return (
    <Link href="/" className="flex items-center justify-between gap-2 pb-2.5 text-[12px] text-muted-foreground">
      <span>
        Placar abre em <span className="num font-semibold text-foreground">{left > 0 ? fmtCountdown(left) : 'instantes'}</span>
      </span>
      <SourceStamp className="text-[11px]" short />
    </Link>
  );
}
