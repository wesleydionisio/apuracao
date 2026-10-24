// Aviso de cookies (LGPD): o site só usa cookies necessários, então é um aviso com link para a política, não uma escolha.
// Some depois do "Entendi" e não volta neste aparelho.
import { useState } from 'react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';

const KEY = 'lgpd-ok';

function seen() {
  try {
    return !!localStorage.getItem(KEY);
  } catch {
    return false;
  }
}

export function CookieBanner() {
  const [open, setOpen] = useState(() => !seen());
  if (!open) return null;
  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      className="fixed inset-x-3 z-40 mx-auto max-w-md rounded-2xl border bg-popover p-3 shadow-[var(--shadow-card)] animate-in fade-in-0 slide-in-from-bottom-2 duration-300 lg:right-auto lg:left-6 lg:mx-0"
      style={{ bottom: 'calc(var(--tabbar-total) + 10px)' }}
    >
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-muted-foreground">
          Usamos só cookies necessários, para login, palpite e chat. Nada de rastreamento para publicidade.{' '}
          <Link href="/privacidade" className="font-medium text-foreground underline underline-offset-2">
            Privacidade
          </Link>
        </p>
        <Button
          size="sm"
          className="h-9 shrink-0 rounded-full px-4"
          onClick={() => {
            try {
              localStorage.setItem(KEY, new Date().toISOString());
            } catch {
              /* sem storage: fecha só nesta visita */
            }
            setOpen(false);
          }}
        >
          Entendi
        </Button>
      </div>
    </div>
  );
}
