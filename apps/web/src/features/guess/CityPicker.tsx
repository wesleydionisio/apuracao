// Busca de município (Command) dentro de um Drawer — rápido no celular, sem teclado de select nativo.
import type { Municipality } from '@apuracao/shared';
import { MapPin } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { staticData } from '@/lib/api';
import { normalizeText } from '@/lib/format';

export function CityPicker({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (m: Municipality) => void;
}) {
  const [list, setList] = useState<Municipality[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!open || list) return;
    staticData
      .municipalities()
      .then((l) => setList((l ?? []).filter((m) => m.uf !== 'ZZ')))
      .catch(() => setList([]));
  }, [open, list]);

  // filtro próprio (sem acento, prioriza começo do nome, maiores primeiro): o do cmdk é lento com 5.570 itens
  const results = useMemo(() => {
    if (!list) return [];
    const n = normalizeText(q);
    if (n.length < 2) return [...list].sort((a, b) => b.el - a.el).slice(0, 8);
    const starts: Municipality[] = [];
    const has: Municipality[] = [];
    for (const m of list) {
      const name = normalizeText(m.name);
      if (name.startsWith(n)) starts.push(m);
      else if (name.includes(n)) has.push(m);
    }
    const byEl = (a: Municipality, b: Municipality) => b.el - a.el;
    return [...starts.sort(byEl), ...has.sort(byEl)].slice(0, 30);
  }, [list, q]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto h-[85dvh] max-w-lg">
        <DrawerHeader className="text-left">
          <DrawerTitle>Sua cidade</DrawerTitle>
          <DrawerDescription>Para palpitar também no resultado da sua cidade.</DrawerDescription>
        </DrawerHeader>
        <Command shouldFilter={false} className="min-h-0 flex-1 bg-transparent px-2">
          <CommandInput value={q} onValueChange={setQ} placeholder="Digite o nome da cidade" autoFocus className="h-11 text-base" />
          <CommandList className="max-h-none flex-1 pb-6">
            {!list ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Carregando municípios…</div>
            ) : (
              <>
                <CommandEmpty>Nenhuma cidade com esse nome.</CommandEmpty>
                <CommandGroup heading={q.trim().length < 2 ? 'Maiores cidades' : 'Resultados'}>
                  {results.map((m) => (
                    <CommandItem
                      key={m.ibge}
                      value={m.ibge}
                      onSelect={() => {
                        onPick(m);
                        onOpenChange(false);
                        setQ('');
                      }}
                      className="min-h-12 gap-3"
                    >
                      <MapPin className="size-4 text-muted-foreground" aria-hidden />
                      <span className="flex-1 truncate">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.uf}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </DrawerContent>
    </Drawer>
  );
}
