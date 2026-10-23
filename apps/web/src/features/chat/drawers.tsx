// Gavetas do chat (vaul), num chunk separado: carregam só no primeiro uso.
import type { CandidateDef, ChatMsg, Room, Side } from '@apuracao/shared';
import { UFS } from '@apuracao/shared';
import { Check, Copy, Flag, Link2, Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from 'wouter';
import { CandidateAvatar } from '@/components/core/candidate';
import { LegalFooter } from '@/components/shell/bits';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { fmtHM } from '@/lib/format';
import { live } from '@/lib/live';
import { share } from '@/lib/share';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { NICK_CLS, NickAvatar, nickColor, PartyBadge, renderBody } from './parts';
import { inviteShare, write } from './rooms';

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

/** "Pra quem você torce?" — perguntado uma vez, na primeira torcida ou mensagem. */
export function SideDrawer({
  open,
  onOpenChange,
  cands,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  cands: [CandidateDef, CandidateDef] | null;
  onDone: (side: Side | null) => void;
}) {
  const pick = (s: Side | null) => {
    live.side(s);
    write('side:asked', '1');
    onDone(s);
    onOpenChange(false);
  };
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="text-left">
          <DrawerTitle className="text-[18px]">Pra quem você torce?</DrawerTitle>
          <DrawerDescription>
            O número aparece ao lado do seu apelido no chat. É só torcida: não conta como voto nem pesquisa, e dá para mudar
            quando quiser.
          </DrawerDescription>
        </DrawerHeader>
        {cands && (
          <div className="grid grid-cols-2 gap-2.5 px-4">
            {cands.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => pick(c.key)}
                className="press flex flex-col items-center gap-2 rounded-2xl border bg-card px-3 pt-4 pb-3.5 transition-colors hover:bg-accent"
                style={{ borderColor: `color-mix(in oklab, ${c.color} 35%, var(--border))` }}
              >
                <CandidateAvatar c={c} size="xl" />
                <span className="text-[15px] font-semibold">{c.short}</span>
                <PartyBadge c={c} party size="md" />
              </button>
            ))}
          </div>
        )}
        <DrawerFooter>
          <Button variant="ghost" className="h-11 text-[14px] text-muted-foreground" onClick={() => pick(null)}>
            Prefiro não dizer
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

/** Perfil no chat: apelido + lado da torcida. */
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
  const [v, setV] = useState(me?.nick ?? '');
  const [side, setSide] = useState<Side | null>(me?.side ?? null);
  const [seen, setSeen] = useState(open);
  // reabriu: começa do estado atual
  if (open && !seen) {
    setSeen(true);
    setV(me?.nick ?? '');
    setSide(me?.side ?? null);
  } else if (!open && seen) setSeen(false);
  const clean = v.trim().replace(/\s+/g, ' ');
  const ok = clean.length >= 2 && clean.length <= 24;
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!ok || !me) return;
            if (clean !== me.nick) {
              write('nick', clean);
              live.nick(clean);
            }
            useBoard.getState().set({ me: { ...me, nick: clean } });
            if (side !== (me.side ?? null)) live.side(side);
            write('side:asked', '1');
            onOpenChange(false);
            toast('Perfil atualizado');
          }}
        >
          <DrawerHeader className="text-left">
            <DrawerTitle>Seu perfil no chat</DrawerTitle>
            <DrawerDescription>Não precisa ser seu nome real. Fica só neste aparelho.</DrawerDescription>
          </DrawerHeader>
          <div className="space-y-5 px-4">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium">Apelido</span>
              <Input
                value={v}
                onChange={(e) => setV(e.target.value.slice(0, 24))}
                maxLength={24}
                autoComplete="nickname"
                className="h-12 rounded-xl text-base"
              />
              <span className="mt-1.5 flex justify-between text-[11px] text-muted-foreground">
                <span>2 a 24 caracteres, sem links ou ofensas</span>
                <span className="num">{clean.length}/24</span>
              </span>
            </label>
            {cands && (
              <fieldset>
                <legend className="mb-1.5 text-[13px] font-medium">Torcida</legend>
                <div className="grid grid-cols-3 gap-2">
                  {cands.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setSide(c.key)}
                      aria-pressed={side === c.key}
                      className={cn(
                        'flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-[12px] font-medium transition-colors',
                        side === c.key ? 'border-foreground bg-accent' : 'hover:bg-accent/60',
                      )}
                    >
                      <PartyBadge c={c} party />
                      <span className="w-full truncate text-center">{c.short}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSide(null)}
                    aria-pressed={side === null}
                    className={cn(
                      'flex min-h-16 items-center justify-center rounded-xl border px-2 text-center text-[12px] font-medium text-muted-foreground transition-colors',
                      side === null ? 'border-foreground bg-accent text-foreground' : 'hover:bg-accent/60',
                    )}
                  >
                    Sem selo
                  </button>
                </div>
              </fieldset>
            )}
          </div>
          <DrawerFooter>
            <Button type="submit" size="lg" disabled={!ok} className="h-12 rounded-xl text-[15px]">
              <Check className="size-4" aria-hidden />
              Salvar
            </Button>
          </DrawerFooter>
        </form>
      </DrawerContent>
    </Drawer>
  );
}

const UF_LIST = Object.entries(UFS).filter(([k]) => k !== 'ZZ');

export function UfDrawer({
  open,
  onOpenChange,
  uf,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  uf: string;
  onPick: (uf: string) => void;
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="text-left">
          <DrawerTitle>Sala do seu estado</DrawerTitle>
          <DrawerDescription>Converse com quem está acompanhando a apuração no mesmo estado.</DrawerDescription>
        </DrawerHeader>
        <div className="grid grid-cols-3 gap-1.5 overflow-y-auto px-4 pb-6">
          {UF_LIST.map(([k, name]) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                onPick(k);
                onOpenChange(false);
              }}
              className={cn(
                'flex min-h-12 flex-col items-start justify-center rounded-lg border px-2.5 py-1.5 text-left transition-colors hover:bg-accent',
                uf === k && 'border-foreground bg-accent',
              )}
            >
              <span className="text-[13px] font-semibold">{k}</span>
              <span className="w-full truncate text-[11px] text-muted-foreground">{name}</span>
            </button>
          ))}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

const newSlug = () => Math.random().toString(36).slice(2, 8);

export function InviteDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const [, nav] = useLocation();
  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="mx-auto max-w-lg">
        <DrawerHeader className="text-left">
          <DrawerTitle>Sala com amigos</DrawerTitle>
          <DrawerDescription>
            Uma sala privada para assistir junto: só entra quem tiver o link. O placar continua ao vivo no topo.
          </DrawerDescription>
        </DrawerHeader>
        <ul className="space-y-2 px-4 pb-2 text-[13px] text-muted-foreground">
          <li className="flex items-center gap-2">
            <Lock className="size-4 shrink-0" aria-hidden /> Fora da lista pública de salas
          </li>
          <li className="flex items-center gap-2">
            <Link2 className="size-4 shrink-0" aria-hidden /> Mande o link no grupo do WhatsApp
          </li>
        </ul>
        <DrawerFooter>
          <Button
            size="lg"
            className="h-12 rounded-xl text-[15px]"
            onClick={async () => {
              const slug = newSlug();
              onOpenChange(false);
              nav(`/sala/${slug}`);
              const r = await share(inviteShare(slug));
              if (r === 'copied') toast('Link da sala copiado. Cole no grupo');
            }}
          >
            <Plus className="size-4" aria-hidden />
            Criar sala e convidar
          </Button>
          <DrawerClose asChild>
            <Button variant="ghost" className="h-11">
              Agora não
            </Button>
          </DrawerClose>
        </DrawerFooter>
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
