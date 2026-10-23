// Moldura do app no celular: cabeçalho fixo com placar, abas no rodapé, rodapé legal.
import type { Board } from '@apuracao/shared';
import { Link, useLocation } from 'wouter';
import { fmtPct, fmtTime } from '../lib/format';
import { candOf, useBoard, type LinkStatus } from '../store/board';
import { TseLink, useNow } from './ui';

export function LiveBadge({ link }: { link: LinkStatus }) {
  const map: Record<LinkStatus, [string, string]> = {
    live: ['ao vivo', 'bg-emerald-500'],
    connecting: ['conectando', 'bg-amber-500'],
    reconnecting: ['reconectando', 'bg-amber-500'],
    offline: ['atualizando a cada 10s', 'bg-zinc-400'],
    demo: ['demo', 'bg-sky-500'],
  };
  const [label, dot] = map[link];
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted">
      <span className={`h-2 w-2 rounded-full ${dot} ${link === 'live' ? 'live-dot' : ''}`} />
      {label}
    </span>
  );
}

export function countdownParts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const two = (n: number) => String(n).padStart(2, '0');

export function fmtCountdown(ms: number) {
  const p = countdownParts(ms);
  return `${p.d ? `${p.d}d ` : ''}${two(p.h)}:${two(p.m)}:${two(p.s)}`;
}

/** Barra A×B. Mostra 50% no meio. */
export function SplitBar({ b, h = 10 }: { b: Board; h?: number }) {
  const ca = candOf(b, 'a')!;
  const cb = candOf(b, 'b')!;
  const pa = b.br?.valid ? b.br.pa : 50;
  return (
    <div className="relative w-full overflow-hidden rounded-full bg-soft" style={{ height: h }}>
      <div className="absolute inset-y-0 left-0 transition-[width] duration-700" style={{ width: `${pa}%`, background: ca.color }} />
      <div className="absolute inset-y-0 right-0 transition-[width] duration-700" style={{ width: `${100 - pa}%`, background: cb.color }} />
      {/* marca dos 50%: a linha de chegada */}
      <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-bg/90" />
    </div>
  );
}

export function Header() {
  const board = useBoard((s) => s.board);
  const link = useBoard((s) => s.link);
  // com o placar grande visível na tela, o cabeçalho não repete os números
  const hero = useBoard((s) => s.heroVisible);
  const now = useNow(1000);
  return (
    <header
      className="safe-t border-b border-line bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80"
    >
      <div className="mx-auto flex max-w-3xl lg:max-w-5xl flex-col gap-1.5 px-4 pb-2 pt-2" style={{ minHeight: 'var(--header-h)' }}>
        {!board ? (
          <div className="flex flex-1 items-center text-sm text-muted">Carregando placar…</div>
        ) : !board.released || !board.br ? (
          <PreHeader board={board} now={now} />
        ) : hero ? (
          <Brand />
        ) : (
          <ScoreHeader board={board} />
        )}
        <div className="flex items-center justify-between gap-2">
          <TseLink />
          <LiveBadge link={link} />
        </div>
      </div>
    </header>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex flex-1 items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="7" fill="currentColor" />
        <rect x="6" y="18" width="5" height="8" rx="1" fill="var(--bg)" />
        <rect x="13.5" y="11" width="5" height="15" rx="1" fill="var(--bg)" opacity=".6" />
        <rect x="21" y="6" width="5" height="20" rx="1" fill="var(--bg)" />
      </svg>
      <span className="text-[17px] font-bold tracking-[-0.01em]">Apuração ao vivo</span>
      <span className="text-[13px] text-muted">2º turno</span>
    </Link>
  );
}

function PreHeader({ board, now }: { board: Board; now: number }) {
  const left = Date.parse(board.releaseAt) - now;
  return (
    <Link href="/" className="flex flex-1 flex-col justify-center">
      <span className="text-[12px] text-muted">O placar abre às 17h (Brasília) de domingo</span>
      <span className="num text-2xl font-bold tracking-tight">{left > 0 ? fmtCountdown(left) : 'aguardando o TSE…'}</span>
    </Link>
  );
}

function ScoreHeader({ board }: { board: Board }) {
  const br = board.br!;
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  return (
    <Link href="/" className="flex flex-col gap-1.5" aria-label="Ver placar">
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium" style={{ color: ca.color }}>
            {ca.short}
          </div>
          <div className="display text-[26px] font-extrabold leading-none">{fmtPct(br.pa)}%</div>
        </div>
        <div className="shrink-0 pb-0.5 text-center">
          <div className="num text-[15px] font-bold leading-none">{fmtPct(br.pst)}%</div>
          <div className="text-[10px] text-muted">urnas apuradas</div>
        </div>
        <div className="min-w-0 text-right">
          <div className="truncate text-[12px] font-medium" style={{ color: cb.color }}>
            {cb.short}
          </div>
          <div className="display text-[26px] font-extrabold leading-none">{fmtPct(br.pb)}%</div>
        </div>
      </div>
      <SplitBar b={board} h={8} />
    </Link>
  );
}

const TABS = [
  { href: '/', label: 'Placar', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2', match: (p: string) => p === '/' },
  { href: '/mapa', label: 'Mapa', icon: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14', match: (p: string) => p.startsWith('/mapa') },
  {
    href: '/chat',
    label: 'Chat',
    icon: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.4A8 8 0 1 1 21 12z',
    match: (p: string) => p.startsWith('/chat') || p.startsWith('/sala'),
  },
  {
    href: '/cidade',
    label: 'Cidade',
    icon: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    match: (p: string) => p.startsWith('/cidade'),
  },
  {
    href: '/palpite',
    label: 'Palpite',
    icon: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3z',
    match: (p: string) => p.startsWith('/palpite') || p.startsWith('/p/'),
  },
];

export function TabBar() {
  const [path] = useLocation();
  return (
    <nav
      className="safe-b fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/85"
      aria-label="Navegação"
    >
      <ul className="mx-auto grid max-w-3xl lg:max-w-5xl grid-cols-5" style={{ height: 'var(--tabbar-h)' }}>
        {TABS.map((t) => {
          const on = t.match(path);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={`flex h-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${on ? 'text-fg' : 'text-muted'}`}
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={on ? 2.4 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d={t.icon} />
                </svg>
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function LegalFooter() {
  return (
    <footer className="mt-8 space-y-2 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
      <p>
        Projeto independente, sem vínculo com o TSE, partidos ou candidatos. Fonte única: TSE. Projeções são estimativas e
        sempre aparecem com o percentual apurado; o resultado oficial é o da totalização do TSE.
      </p>
      <p>
        Chat: seja gentil. Sem links, ofensas ou ameaças; mensagens de até 240 caracteres. Guardamos apenas apelido, um
        cookie anônimo e o IP (para limitar abuso). Mensagens podem ser removidas após denúncias.
      </p>
      <p>
        <Link href="/tv" className="underline">Modo TV</Link> ·{' '}
        <a href="/embed/placar" className="underline">Embed para portais</a>
      </p>
    </footer>
  );
}

export function UpdatedAt({ iso }: { iso?: string | null }) {
  return <span className="num">{fmtTime(iso)}</span>;
}
