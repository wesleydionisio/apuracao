// Gavetas do chat (vaul), num chunk separado: carregam só no primeiro uso.
import type { CandidateDef, ChatMsg, Room, Side } from '@apuracao/shared';
import { Check, Copy, Flag, LogOut } from 'lucide-react';
import { useState } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { LegalFooter } from '@/components/shell/bits';
import { LineBone } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui';
import { auth } from '@/lib/auth';
import { fmtHM } from '@/lib/format';
import { live } from '@/lib/live';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { NICK_CLS, NickAvatar, nickColor, PartyBadge, renderBody } from './parts';

/** Ações por mensagem (toque): copiar e denunciar. 3 denúncias de pessoas diferentes removem. */
export function MessageActions({
  m,
  room,
  cands,
  onClose,
}: {
  m: ChatMsg | null;
  room: Room;
  cands: [CandidateDef, CandidateDef] | null;
  onClose: () => void;
}) {
  const side = m?.side ? cands?.find((c) => c.key === m.side) : null;
  return (
    <Drawer open={!!m} onOpenChange={(o) => !o && onClose()}>
      <DrawerContent className="mx-auto max-w-lg">
        {m && (
          <>
            <DrawerHeader className="text-left">
              <div className="flex items-center gap-2.5">
                <NickAvatar m={m} />
                <div className="min-w-0">
                  <DrawerTitle className={cn('flex items-center gap-1.5 truncate text-[15px]', NICK_CLS)} style={nickColor(m.hue)}>
                    {m.nick}
                    {side && <PartyBadge c={side} party />}
                  </DrawerTitle>
                  <span className="num text-[12px] text-muted-foreground">{fmtHM(new Date(m.at).toISOString())}</span>
                </div>
              </div>
              <DrawerDescription asChild>
                <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-[15px] break-words text-foreground">{renderBody(m.body, cands)}</div>
              </DrawerDescription>
            </DrawerHeader>
            <DrawerFooter className="gap-2">
              <Button
                variant="outline"
                className="h-12 justify-start rounded-xl text-[15px]"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(m.body);
                    toast('Mensagem copiada');
                  } catch {
                    toast('Não deu para copiar');
                  }
                  onClose();
                }}
              >
                <Copy className="size-4" aria-hidden />
                Copiar texto
              </Button>
              <Button
                variant="outline"
                className="h-12 justify-start rounded-xl text-[15px] text-destructive hover:text-destructive"
                onClick={() => {
                  live.report(room, m.id);
                  toast('Denúncia enviada. Obrigado por ajudar a moderar.');
                  onClose();
                }}
              >
                <Flag className="size-4" aria-hidden />
                Denunciar mensagem
              </Button>
              <p className="px-1 text-[12px] text-muted-foreground">
                Mensagens com 3 denúncias de pessoas diferentes saem do ar automaticamente.
              </p>
            </DrawerFooter>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** Perfil no chat: nome de usuário da conta, lado da torcida e sair. */
export function ProfileDrawer({
  open,
  onOpenChange,
  cands,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cands: [CandidateDef, CandidateDef] | null;
}) {
  const me = useBoard((s) => s.me);
  const [side, setSide] = useState<Side | null>(me?.side ?? null);
  const [seen, setSeen] = useState(open);
  // reabriu: começa do estado atual
  if (open && !seen) {
    setSeen(true);
    setSide(me?.side ?? null);
  } else if (!open && seen) setSeen(false);
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (side && side !== (me?.side ?? null)) live.side(side);
            onOpenChange(false);
            toast('Perfil atualizado');
          }}
        >
          <DrawerHeader className="text-left">
            {me ? (
              <div className="flex items-center gap-2.5">
                <NickAvatar m={me} className="size-10" />
                <div className="min-w-0">
                  <DrawerTitle className={cn('truncate text-[17px]', NICK_CLS)} style={nickColor(me.hue)}>
                    {me.nick}
                  </DrawerTitle>
                  <DrawerDescription>É como você aparece no chat.</DrawerDescription>
                </div>
              </div>
            ) : (
              // a conta ainda não chegou: o mesmo cabeçalho em fantasma, para a gaveta não crescer quando ela chegar
              <div className="flex items-center gap-2.5" aria-busy="true">
                <Skeleton className="size-10 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1">
                  <DrawerTitle className="text-[17px]">
                    <span className="sr-only">Seu perfil</span>
                    <LineBone w="w-28" />
                  </DrawerTitle>
                  <DrawerDescription>É como você aparece no chat.</DrawerDescription>
                </div>
              </div>
            )}
          </DrawerHeader>
          {!cands && (
            <div className="px-4" aria-hidden>
              <LineBone className="mb-1.5 text-[13px]" w="w-16" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-14 rounded-xl" />
                <Skeleton className="h-14 rounded-xl" />
              </div>
            </div>
          )}
          {cands && (
            <fieldset className="px-4">
              <legend className="mb-1.5 text-[13px] font-medium">Seu lado</legend>
              <div className="grid grid-cols-2 gap-2">
                {cands.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setSide(c.key)}
                    aria-pressed={side === c.key}
                    className={cn(
                      'flex min-h-14 items-center gap-2.5 rounded-xl border px-3 py-2 text-[13px] font-medium transition-colors',
                      side === c.key ? 'border-foreground bg-accent' : 'hover:bg-accent/60',
                    )}
                  >
                    <CandidateAvatar c={c} size="sm" className="rounded-full" />
                    <span className="min-w-0 flex-1 truncate text-left">{c.short}</span>
                    <PartyBadge c={c} />
                  </button>
                ))}
              </div>
            </fieldset>
          )}
          <DrawerFooter>
            <Button type="submit" size="lg" className="h-12 rounded-xl text-[15px]">
              <Check className="size-4" aria-hidden />
              Salvar
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-11 text-[14px] text-muted-foreground"
              onClick={async () => {
                await auth.logout().catch(() => {});
                onOpenChange(false);
                live.reconnect();
                toast('Você saiu da conta');
              }}
            >
              <LogOut className="size-4" aria-hidden />
              Sair da conta
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

export function InfoDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="text-left">
          <DrawerTitle>Sobre os dados</DrawerTitle>
          <DrawerDescription className="sr-only">Fonte, aviso legal e termos do chat</DrawerDescription>
        </DrawerHeader>
        <div className="-mt-8 px-4 pb-6">
          <LegalFooter />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
