// Abas no rodapé: alvos de 60px de altura, ícone + rótulo, indicador do ativo.
import { ChartNoAxesColumn, Map, MapPin, Radio, Target, type LucideIcon } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import { cn } from '@/lib/utils';

const TABS: { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: '/', label: 'Ao vivo', icon: Radio, match: (p) => p === '/' || p.startsWith('/sala') || p.startsWith('/chat') },
  { href: '/painel', label: 'Painel', icon: ChartNoAxesColumn, match: (p) => p.startsWith('/painel') },
  { href: '/mapa', label: 'Mapa', icon: Map, match: (p) => p.startsWith('/mapa') },
  { href: '/cidade', label: 'Cidade', icon: MapPin, match: (p) => p.startsWith('/cidade') },
  { href: '/palpite', label: 'Palpite', icon: Target, match: (p) => p.startsWith('/palpite') || p.startsWith('/p/') },
];

export function TabBar() {
  const [path] = useLocation();
  return (
    <nav
      className="safe-b fixed inset-x-0 bottom-0 z-30 border-t bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/75"
      aria-label="Navegação"
    >
      <ul className="mx-auto grid max-w-3xl grid-cols-5 lg:max-w-6xl" style={{ height: 'var(--tabbar-h)' }}>
        {TABS.map((t) => {
          const on = t.match(path);
          const Icon = t.icon;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={on ? 'page' : undefined}
                className={cn(
                  'press relative flex h-full flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors',
                  on ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0 h-[2px] w-8 rounded-full bg-foreground transition-opacity duration-200',
                    on ? 'opacity-100' : 'opacity-0',
                  )}
                  aria-hidden
                />
                <Icon className="size-[22px]" strokeWidth={on ? 2.25 : 1.75} aria-hidden />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
