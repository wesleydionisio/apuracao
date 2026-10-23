// Busca de cidade com Command (cmdk). Filtragem própria: 5,5 mil itens e acento-insensível.
import type { Municipality } from '@apuracao/shared';
import { ufName } from '@apuracao/shared';
import { Clock, MapPin, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { fmtCompact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { readRecents, useCitySearch, type RecentCity } from './search';

export function CityCommand({
  onPick,
  placeholder = 'Buscar cidade',
  autoFocus = false,
  showSuggestions = true,
  className,
  listClassName,
}: {
  onPick: (m: RecentCity | Municipality) => void;
  placeholder?: string;
  autoFocus?: boolean;
  showSuggestions?: boolean;
  className?: string;
  listClassName?: string;
}) {
  const [q, setQ] = useState('');
  const [recents, setRecents] = useState<RecentCity[]>([]);
  const { idx, results } = useCitySearch(q, showSuggestions);
  useEffect(() => setRecents(readRecents()), []);
  const biggest = showSuggestions && idx ? idx.slice(0, 8).map((x) => x.m) : [];
  const searching = q.trim().length >= 2;

  return (
    <Command shouldFilter={false} className={cn('bg-transparent', className)} label="Buscar cidade">
      <CommandInput
        value={q}
        onValueChange={setQ}
        placeholder={placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
        autoComplete="off"
        className="h-12 text-base"
      />
      <CommandList className={cn('max-h-none', listClassName)}>
        {searching && (
          <>
            {!idx ? (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">Carregando cidades…</div>
            ) : (
              <CommandEmpty>Nenhuma cidade com esse nome.</CommandEmpty>
            )}
            {!!results.length && (
              <CommandGroup heading="Cidades">
                {results.map((m) => (
                  <CityItem key={m.ibge} m={m} onSelect={() => onPick(m)} />
                ))}
              </CommandGroup>
            )}
          </>
        )}
        {!searching && showSuggestions && (
          <>
            {!!recents.length && (
              <CommandGroup heading="Vistas recentemente">
                {recents.map((m) => (
                  <CommandItem key={`r-${m.ibge}`} value={`r-${m.ibge}`} onSelect={() => onPick(m)} className="min-h-12 gap-3">
                    <Clock className="text-muted-foreground" />
                    <span className="flex-1 truncate">{m.name}</span>
                    <span className="text-xs text-muted-foreground">{m.uf}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {!!biggest.length && (
              <CommandGroup heading="Maiores cidades">
                {biggest.map((m) => (
                  <CityItem key={`b-${m.ibge}`} m={m} onSelect={() => onPick(m)} />
                ))}
              </CommandGroup>
            )}
          </>
        )}
      </CommandList>
    </Command>
  );
}

function CityItem({ m, onSelect }: { m: Municipality; onSelect: () => void }) {
  return (
    <CommandItem value={m.ibge} onSelect={onSelect} className="min-h-12 gap-3">
      <MapPin className="text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block truncate">{m.name}</span>
        <span className="num block text-[11px] text-muted-foreground">
          {ufName(m.uf)} · {fmtCompact(m.el)} eleitores
        </span>
      </span>
    </CommandItem>
  );
}

/** botão com cara de campo de busca que abre a busca num Drawer (celular) */
export function CityPicker({
  onPick,
  label = 'Buscar outra cidade',
  compact = false,
  className,
}: {
  onPick: (m: RecentCity | Municipality) => void;
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Drawer open={open} onOpenChange={setOpen} repositionInputs={false}>
      <DrawerTrigger asChild>
        {compact ? (
          <Button variant="outline" size="icon" className={cn('size-10 rounded-full', className)} aria-label={label}>
            <Search />
          </Button>
        ) : (
          <button
            type="button"
            className={cn(
              'press flex h-12 w-full items-center gap-2 rounded-xl border bg-card px-3 text-left text-[15px] text-muted-foreground shadow-xs hover:bg-accent/40',
              className,
            )}
          >
            <Search className="size-4" />
            {label}
          </button>
        )}
      </DrawerTrigger>
      <DrawerContent className="data-[vaul-drawer-direction=bottom]:h-[88dvh] data-[vaul-drawer-direction=bottom]:max-h-[88dvh]">
        <DrawerHeader className="sr-only">
          <DrawerTitle>Buscar cidade</DrawerTitle>
          <DrawerDescription>Digite o nome do município</DrawerDescription>
        </DrawerHeader>
        <CityCommand
          autoFocus
          onPick={(m) => {
            setOpen(false);
            onPick(m);
          }}
          className="min-h-0 flex-1 px-2"
          listClassName="flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]"
        />
      </DrawerContent>
    </Drawer>
  );
}
