// Busca de cidade embutida (usada no formulário de palpite). Mesma API de antes; por baixo é o Command.
import type { Municipality } from '@apuracao/shared';
import { useState } from 'react';
import { CityCommand } from '@/features/city/CityCommand';
import { loadCityIndex } from '@/features/city/search';

export function CitySearch({
  onPick,
  placeholder = 'Digite o nome da sua cidade',
  compact = false,
  autoFocus = false,
}: {
  onPick: (m: Municipality) => void;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const [k, setK] = useState(0);
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <CityCommand
        key={k}
        placeholder={placeholder}
        autoFocus={autoFocus}
        showSuggestions={!compact}
        listClassName={compact ? 'max-h-64 overflow-y-auto' : 'max-h-80 overflow-y-auto'}
        onPick={async (m) => {
          // recentes trazem só o básico; o formulário precisa do município completo
          const full = 'el' in m ? m : (await loadCityIndex()).find((x) => x.m.ibge === m.ibge)?.m;
          if (full) onPick(full);
          setK((x) => x + 1); // limpa o campo
        }}
      />
    </div>
  );
}
