// Compra do Super Chat: valor + mensagem (com prévia do cartão) → Pix (QR e copia e cola) → no ar.
// A mensagem passa pela moderação do chat antes do Pix ser gerado. Gaveta num chunk próprio: carrega no primeiro uso.
import type { CandidateDef, ChatMsg, Room, ScCharge } from '@apuracao/shared';
import { fmtBrl, SC_MAX, SC_MIN, SC_PRESETS, scTier } from '@apuracao/shared';
import { Check, Copy, Loader2, Pin } from 'lucide-react';
import { useEffect, useState } from 'react';
import { LineBone } from '@/components/skeletons';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import { toast, useNow } from '@/components/ui';
import { superchatApi, HttpError } from '@/lib/api';
import { savedSide } from '@/lib/live';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { SuperLine } from './superchat';

const PENDING = 'sc-pending';

const ERR: Record<string, string> = {
  long: 'Mensagem longa demais para este valor.',
  invalid: 'Mensagem inválida.',
  muted: 'Você está silenciado no chat agora. Tente mais tarde.',
  rate: 'Muitas tentativas seguidas. Espere um pouco.',
  pix: 'Não deu para gerar o Pix agora. Tente de novo em instantes.',
  off: 'Super Chat indisponível no momento.',
  amount: `Escolha um valor entre ${fmtBrl(SC_MIN)} e ${fmtBrl(SC_MAX)}.`,
};

const fmtPin = (s: number) => (s >= 3600 ? `${s / 3600} h` : `${s / 60} min`);

function readPending(): string | null {
  try {
    return sessionStorage.getItem(PENDING);
  } catch {
    return null;
  }
}
function writePending(id: string | null) {
  try {
    if (id) sessionStorage.setItem(PENDING, id);
    else sessionStorage.removeItem(PENDING);
  } catch {
    /* sem storage */
  }
}

export default function SuperchatSheet({
  open,
  onOpenChange,
  room,
  cands,
  onAuth,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  room: Room;
  cands: [CandidateDef, CandidateDef] | null;
  /** a sessão caiu: pedir login de novo */
  onAuth: () => void;
}) {
  const me = useBoard((s) => s.me);
  const [amount, setAmount] = useState(1000);
  const [custom, setCustom] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [charge, setCharge] = useState<ScCharge | null>(null);
  /** Pix pendente já conferido (achado ou descartado) */
  const [checked, setChecked] = useState<string | null>(null);

  // reabriu com um Pix ainda aberto: volta para ele
  useEffect(() => {
    if (!open || charge) return;
    const id = readPending();
    if (!id) return;
    // rede travada: depois de 4s desiste e mostra o formulário (o Pix antigo segue valendo se for pago)
    const t = setTimeout(() => setChecked(id), 4000);
    superchatApi
      .get(id)
      .then((c) => (c.status === 'pending' ? setCharge(c) : writePending(null)))
      .catch(() => writePending(null))
      .finally(() => {
        clearTimeout(t);
        setChecked(id);
      });
    return () => clearTimeout(t);
  }, [open, charge]);
  // enquanto confere o Pix guardado, a gaveta já abre no tamanho da tela do Pix (e não no formulário, que trocaria depois)
  const pendingId = open && !charge ? readPending() : null;
  const restoring = !!pendingId && checked !== pendingId;

  // pagando: confere a cada 3s
  const status = charge?.status;
  useEffect(() => {
    if (!charge || status !== 'pending' || !open) return;
    const t = setInterval(() => {
      superchatApi
        .get(charge.id)
        .then((c) => {
          setCharge(c);
          if (c.status !== 'pending') writePending(null);
        })
        .catch(() => {});
    }, 3000);
    return () => clearInterval(t);
  }, [charge?.id, status, open]);

  const tier = scTier(amount);
  const chars = [...body].length;
  const tooLong = chars > tier.chars;
  const preview: ChatMsg = { id: 'preview', nick: me?.nick ?? 'você', hue: me?.hue ?? 200, body: body.trim(), at: Date.now(), sc: amount, ...(savedSide() ? { side: savedSide()! } : {}) };

  async function pay() {
    if (busy || tooLong) return;
    setBusy(true);
    setErr(null);
    try {
      const c = await superchatApi.create({ room, body: body.trim(), amount, side: savedSide() });
      setCharge(c);
      writePending(c.id);
    } catch (e) {
      const code = e instanceof HttpError ? e.code : undefined;
      if (code === 'auth') return onAuth();
      if (code === 'blocked') {
        setErr('Sua mensagem não passou na moderação do chat. Edite e tente de novo.');
      } else setErr(ERR[code ?? ''] ?? 'Não deu para gerar o Pix. Verifique a conexão.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setCharge(null);
    writePending(null);
    setBody('');
    setErr(null);
  }

  return (
    <Drawer
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        // fechou depois de pago ou vencido: a próxima abertura começa do zero
        if (!o && charge && charge.status !== 'pending') reset();
      }}
    >
      <DrawerContent className="mx-auto max-w-lg">
        {restoring ? (
          <PayStepSkeleton />
        ) : !charge ? (
          <>
            <DrawerHeader className="pb-2 text-left">
              <DrawerTitle className="text-[18px]">Super Chat</DrawerTitle>
              <DrawerDescription className="text-[13px]">Destaque sua mensagem no chat, pago com Pix.</DrawerDescription>
            </DrawerHeader>
            <div className="overflow-y-auto px-4 pb-4">
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Valor">
                {SC_PRESETS.map((v) => {
                  const t = scTier(v);
                  const on = amount === v && !custom;
                  return (
                    <button
                      key={v}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        setAmount(v);
                        setCustom('');
                      }}
                      className={cn('press num flex h-11 items-center justify-center gap-1.5 rounded-xl border text-[15px] font-semibold transition-colors', on ? 'border-transparent' : 'bg-card hover:bg-accent')}
                      style={on ? { background: t.color, color: t.ink } : undefined}
                    >
                      {!on && <span className="size-2 rounded-full" style={{ background: t.color }} aria-hidden />}
                      {fmtBrl(v)}
                    </button>
                  );
                })}
              </div>
              <label className="mt-2 flex h-11 items-center gap-2 rounded-xl border bg-card px-3 text-[14px] focus-within:ring-[3px] focus-within:ring-ring/30">
                <span className="text-muted-foreground">Outro valor R$</span>
                <input
                  value={custom}
                  inputMode="numeric"
                  placeholder={String(SC_MIN / 100)}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 4);
                    setCustom(v);
                    if (v) setAmount(Math.min(SC_MAX, Math.max(SC_MIN, Number(v) * 100)));
                  }}
                  className="num min-w-0 flex-1 bg-transparent font-semibold outline-none"
                  aria-label="Outro valor em reais"
                />
              </label>

              <div className="mt-3">
                <textarea
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setErr(null);
                  }}
                  rows={2}
                  placeholder="Sua mensagem (opcional)"
                  className="w-full resize-none rounded-xl border border-input bg-muted/50 px-3 py-2.5 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:bg-background focus-visible:ring-[3px] focus-visible:ring-ring/30"
                  aria-label="Mensagem do Super Chat"
                />
                <div className="mt-1 flex items-center justify-between text-[11.5px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Pin className="size-3" aria-hidden />
                    {tier.pin ? `Fixado no topo por ${fmtPin(tier.pin)}` : 'Aparece no chat (fixa a partir de R$ 10)'}
                  </span>
                  <span className={cn('num', tooLong && 'font-semibold text-destructive')}>
                    {chars}/{tier.chars}
                  </span>
                </div>
              </div>

              <p className="mt-3 mb-1 text-[11.5px] font-medium text-muted-foreground">Prévia</p>
              <div className="-mx-2">
                <SuperLine m={preview} cands={cands} />
              </div>

              {err && (
                <p className="mt-2 text-[12.5px] font-medium text-destructive" role="alert">
                  {err}
                </p>
              )}
              <Button onClick={pay} disabled={busy || tooLong} className="mt-3 h-12 w-full rounded-xl text-[15px] font-semibold">
                {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : `Gerar Pix de ${fmtBrl(amount)}`}
              </Button>
              <p className="mt-2 text-center text-[11px] leading-snug text-muted-foreground">
                A mensagem passa pela moderação do chat antes do Pix. Super Chat que violar as regras pode ser removido.
              </p>
            </div>
          </>
        ) : (
          <PayStep charge={charge} onPaidClose={() => onOpenChange(false)} onRetry={reset} onDevPaid={setCharge} />
        )}
      </DrawerContent>
    </Drawer>
  );
}

/** a tela do Pix em fantasma, com as mesmas medidas (cabeçalho, QR, botão e aviso) */
function PayStepSkeleton() {
  return (
    <div className="overflow-y-auto px-4 pb-6" aria-busy="true">
      <DrawerHeader className="px-0 pb-3 text-center">
        <DrawerTitle className="text-[18px]">
          <span className="sr-only">Pix do Super Chat</span>
          <LineBone w="w-52" />
        </DrawerTitle>
        <DrawerDescription asChild>
          <div className="text-[13px]">
            <LineBone w="w-72" />
            <LineBone w="w-40" />
          </div>
        </DrawerDescription>
      </DrawerHeader>
      <Skeleton className="mx-auto size-52 rounded-xl" />
      <Skeleton className="mt-3 h-12 w-full rounded-xl" />
      <LineBone className="mt-3 text-center text-[13px]" w="w-44" />
    </div>
  );
}

function PayStep({ charge, onPaidClose, onRetry, onDevPaid }: { charge: ScCharge; onPaidClose: () => void; onRetry: () => void; onDevPaid: (c: ScCharge) => void }) {
  const now = useNow(1000);
  const [copied, setCopied] = useState(false);
  const left = Math.max(0, Date.parse(charge.expiresAt) - now);
  const expired = charge.status === 'expired' || (charge.status === 'pending' && left === 0);

  if (charge.status === 'paid' || charge.status === 'hidden') {
    return (
      <div className="px-6 pt-4 pb-8 text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[var(--live)] text-white animate-in zoom-in-50 duration-300">
          <Check className="size-7" aria-hidden />
        </span>
        <DrawerTitle className="mt-3 text-[20px]">Super Chat no ar!</DrawerTitle>
        <DrawerDescription className="mt-1 text-[13px]">Pagamento de {fmtBrl(charge.amount)} confirmado. Obrigado pelo apoio.</DrawerDescription>
        <Button onClick={onPaidClose} className="mt-5 h-12 w-full rounded-xl text-[15px]">
          Voltar ao chat
        </Button>
      </div>
    );
  }

  if (expired) {
    return (
      <div className="px-6 pt-4 pb-8 text-center">
        <DrawerTitle className="text-[18px]">O Pix expirou</DrawerTitle>
        <DrawerDescription className="mt-1 text-[13px]">Nada foi cobrado. Gere outro para mandar o Super Chat.</DrawerDescription>
        <Button onClick={onRetry} className="mt-5 h-12 w-full rounded-xl text-[15px]">
          Gerar outro Pix
        </Button>
      </div>
    );
  }

  const mm = Math.floor(left / 60_000);
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0');
  return (
    <div className="overflow-y-auto px-4 pb-6">
      <DrawerHeader className="px-0 pb-3 text-center">
        <DrawerTitle className="text-[18px]">Pague {fmtBrl(charge.amount)} com Pix</DrawerTitle>
        <DrawerDescription className="text-[13px]">
          Abra o app do banco e leia o QR ou use o copia e cola. Vale por <span className="num font-semibold text-foreground">{mm}:{ss}</span>.
        </DrawerDescription>
      </DrawerHeader>
      <img src={charge.qrPng} alt="QR code do Pix" className="mx-auto size-52 rounded-xl border bg-white p-2" />
      <Button
        variant="outline"
        className="mt-3 h-12 w-full rounded-xl text-[15px]"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(charge.qr);
            setCopied(true);
            toast('Código Pix copiado');
            setTimeout(() => setCopied(false), 2500);
          } catch {
            toast('Não deu para copiar');
          }
        }}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? 'Copiado' : 'Copiar código Pix'}
      </Button>
      <p className="mt-3 flex items-center justify-center gap-2 text-[13px] text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {charge.provider === 'manual' ? 'Aguardando a confirmação do pagamento (pode levar alguns minutos)…' : 'Aguardando o pagamento…'}
      </p>
      {(charge.provider === 'dev' || charge.sandbox) && (
        <Button
          variant="secondary"
          className="mt-3 h-10 w-full rounded-xl text-[13px]"
          onClick={() => superchatApi.devPay(charge.id).then(onDevPaid).catch(() => toast('Não deu para simular'))}
        >
          {charge.sandbox ? 'Simular pagamento (sandbox da Woovi)' : 'Simular pagamento (só em dev)'}
        </Button>
      )}
    </div>
  );
}
