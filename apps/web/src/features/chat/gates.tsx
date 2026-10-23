// Portas do chat: camadas sobre o chat desfocado.
//  - SideGate: no primeiro acesso, "Qual é o seu lado?" (sem lado não dá para torcer nem comentar);
//  - LoginGate: ao mandar a primeira mensagem, entrar com o Google e, se a conta é nova, nome, celular e usuário.
import type { CandidateDef, Side } from '@apuracao/shared';
import { ArrowLeft, Check, Loader2, X } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CandidateAvatar } from '@/components/core/candidate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { auth, errCode, loadGis, maskPhone, SIGNUP_ERR, type AuthInfo, type SignInResult, type SignupStart } from '@/lib/auth';
import { cn } from '@/lib/utils';

/** camada sobre o chat: o fundo fica desfocado; tocar fora do conteúdo ou Esc fecha */
function Overlay({ children, label, onDismiss }: { children: ReactNode; label: string; onDismiss: () => void }) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss.current();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  return (
    <div
      className="absolute inset-0 z-30 flex overflow-y-auto overscroll-contain bg-background/75 p-4 backdrop-blur-lg animate-in fade-in-0 duration-200"
      role="dialog"
      aria-modal="true"
      aria-label={label}
      // fora = o fundo ou a área vazia em volta do conteúdo (não um botão/cartão dentro dele)
      onClick={(e) => (e.target === e.currentTarget || (e.target as HTMLElement).dataset.backdrop) && onDismiss()}
    >
      {/* m-auto centraliza e, se não couber, deixa rolar desde o topo */}
      <div data-backdrop="1" className="m-auto w-full max-w-[22rem] animate-in zoom-in-95 slide-in-from-bottom-2 duration-200">
        {children}
      </div>
    </div>
  );
}

const tint = (c: CandidateDef, pct: number) => `color-mix(in oklab, ${c.color} ${pct}%, transparent)`;

export function SideGate({ cands, onPick, onClose }: { cands: [CandidateDef, CandidateDef]; onPick: (s: Side) => void; onClose: () => void }) {
  return (
    <Overlay label="Escolha seu lado" onDismiss={onClose}>
      <div data-backdrop="1" className="text-center">
        <h2 className="text-[22px] leading-tight font-bold tracking-tight text-balance">Qual é o seu lado?</h2>
        <p className="mx-auto mt-1 max-w-[30ch] text-[13px] leading-snug text-muted-foreground">Escolha para entrar no chat e torcer.</p>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {cands.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => onPick(c.key)}
            className="group relative flex flex-col items-center gap-2.5 overflow-hidden rounded-2xl border-2 bg-card px-3 pt-4 pb-3.5 transition-[transform,box-shadow] duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.97]"
            style={{ borderColor: tint(c, 55), boxShadow: `0 10px 30px -12px ${tint(c, 60)}` }}
          >
            <span className="absolute inset-x-0 top-0 h-16 opacity-60" style={{ background: `linear-gradient(${tint(c, 35)}, transparent)` }} aria-hidden />
            <CandidateAvatar c={c} size="lg" ring className="relative rounded-full ring-offset-card" />
            <span className="relative text-[14px] leading-tight font-semibold">{c.short}</span>
            <span
              className="num relative inline-flex h-7 min-w-12 items-center justify-center rounded-full px-3 text-[15px] font-extrabold text-white"
              style={{ background: c.color }}
            >
              {c.n}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-center text-[11.5px] text-muted-foreground">Não é voto nem pesquisa. Dá para trocar depois.</p>
    </Overlay>
  );
}

type Step = { k: 'login' } | { k: 'signup'; s: SignupStart };

export function LoginGate({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [info, setInfo] = useState<AuthInfo | null>(null);
  const [step, setStep] = useState<Step>({ k: 'login' });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    auth
      .info()
      .then(setInfo)
      .catch(() => setErr('Não deu para carregar o login. Tente de novo.'));
  }, []);

  const handle = (r: SignInResult) => {
    setErr(null);
    if ('user' in r) onDone();
    else setStep({ k: 'signup', s: r.signup });
  };

  return (
    <Overlay label="Entrar para comentar" onDismiss={onClose}>
      <div className="relative rounded-3xl border bg-card p-5 shadow-2xl">
        <button
          type="button"
          onClick={step.k === 'signup' ? () => setStep({ k: 'login' }) : onClose}
          className="absolute top-3 left-3 flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={step.k === 'signup' ? 'Voltar' : 'Fechar'}
        >
          {step.k === 'signup' ? <ArrowLeft className="size-4" /> : <X className="size-4" />}
        </button>
        {step.k === 'login' ? (
          <>
            <div className="px-6 pt-2 text-center">
              <h2 className="text-[20px] leading-tight font-bold tracking-tight">Entre para comentar</h2>
              <p className="mt-1.5 text-[13px] leading-snug text-muted-foreground">
                Para manter o chat limpo, só manda mensagem quem entra com o Google. Torcer continua liberado.
              </p>
            </div>
            <div className="mt-5 flex min-h-11 justify-center">
              {!info ? (
                !err && <Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Carregando" />
              ) : info.google ? (
                <GoogleButton clientId={info.google} onResult={handle} onError={setErr} />
              ) : info.dev ? (
                <DevLogin onResult={handle} onError={setErr} />
              ) : (
                <p className="text-center text-[13px] text-muted-foreground">Login indisponível no momento.</p>
              )}
            </div>
          </>
        ) : (
          <SignupForm s={step.s} onDone={onDone} onExpired={() => setStep({ k: 'login' })} onError={setErr} />
        )}
        {err && (
          <p className="mt-3 text-center text-[12.5px] font-medium text-destructive" role="alert">
            {err}
          </p>
        )}
      </div>
    </Overlay>
  );
}

function GoogleButton({ clientId, onResult, onError }: { clientId: string; onResult: (r: SignInResult) => void; onError: (e: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const cb = useRef({ onResult, onError });
  cb.current = { onResult, onError };
  useEffect(() => {
    let alive = true;
    loadGis()
      .then((gis) => {
        if (!alive || !ref.current) return;
        gis.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          use_fedcm_for_button: true,
          callback: ({ credential }) => {
            setBusy(true);
            auth
              .google(credential)
              .then((r) => cb.current.onResult(r))
              .catch(() => cb.current.onError('O Google não confirmou o login. Tente de novo.'))
              .finally(() => setBusy(false));
          },
        });
        gis.renderButton(ref.current, { theme: 'filled_black', size: 'large', shape: 'pill', text: 'continue_with', locale: 'pt-BR', width: 280 });
      })
      .catch(() => cb.current.onError('Não deu para abrir o login do Google. Verifique a conexão.'));
    return () => {
      alive = false;
    };
  }, [clientId]);
  return (
    <div className="relative">
      {/* o iframe do Google é "light": num pai com color-scheme dark o navegador pinta um fundo branco opaco atrás */}
      <div ref={ref} style={{ colorScheme: 'light' }} className={cn('min-h-11', busy && 'pointer-events-none opacity-40')} />
      {busy && <Loader2 className="absolute inset-0 m-auto size-5 animate-spin" aria-label="Entrando" />}
    </div>
  );
}

/** só em dev, sem Client ID do Google: um e-mail qualquer faz o papel da conta */
function DevLogin({ onResult, onError }: { onResult: (r: SignInResult) => void; onError: (e: string) => void }) {
  const [email, setEmail] = useState('teste@exemplo.com');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="w-full space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        auth
          .dev(email)
          .then(onResult)
          .catch(() => onError('E-mail inválido.'))
          .finally(() => setBusy(false));
      }}
    >
      <Input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className="h-11 rounded-full text-[15px]" aria-label="E-mail de teste" />
      <Button type="submit" disabled={busy} className="h-11 w-full rounded-full text-[14px]">
        Entrar (teste local, sem Google)
      </Button>
    </form>
  );
}

function SignupForm({ s, onDone, onExpired, onError }: { s: SignupStart; onDone: () => void; onExpired: () => void; onError: (e: string | null) => void }) {
  const [name, setName] = useState(s.name);
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState(s.name.split(' ').slice(0, 2).join(' ').slice(0, 24));
  const [check, setCheck] = useState<'idle' | 'busy' | 'ok' | 'taken' | 'invalid'>('idle');
  const [busy, setBusy] = useState(false);
  const u = username.trim();

  // disponibilidade do usuário enquanto digita
  useEffect(() => {
    if (u.length < 2) return setCheck('idle');
    setCheck('busy');
    const t = setTimeout(() => {
      auth
        .usernameOk(u)
        .then((r) => setCheck(!r.valid ? 'invalid' : r.ok ? 'ok' : 'taken'))
        .catch(() => setCheck('idle'));
    }, 350);
    return () => clearTimeout(t);
  }, [u]);

  const phoneOk = phone.replace(/\D/g, '').length >= 10;
  const ok = name.trim().length >= 2 && phoneOk && u.length >= 2 && check !== 'taken' && check !== 'invalid';
  return (
    <form
      className="pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok || busy) return;
        setBusy(true);
        onError(null);
        auth
          .signup({ token: s.token, name, phone, username: u })
          .then(onDone)
          .catch((e2) => {
            const c = errCode(e2);
            if (c === 'expired') onExpired();
            if (c === 'taken') setCheck('taken');
            onError(SIGNUP_ERR[c] ?? 'Não deu para criar a conta. Tente de novo.');
          })
          .finally(() => setBusy(false));
      }}
    >
      <div className="px-6 text-center">
        <h2 className="text-[20px] leading-tight font-bold tracking-tight">Falta pouco</h2>
        <p className="mt-1 truncate text-[12.5px] text-muted-foreground">{s.email}</p>
      </div>
      <div className="mt-4 space-y-3">
        <Field label="Nome">
          <Input value={name} onChange={(e) => setName(e.target.value.slice(0, 80))} autoComplete="name" className="h-11 rounded-xl text-base" required />
        </Field>
        <Field label="Celular" hint="Não aparece no chat.">
          <Input
            value={phone}
            onChange={(e) => setPhone(maskPhone(e.target.value))}
            inputMode="tel"
            autoComplete="tel-national"
            placeholder="(11) 91234-5678"
            className="h-11 rounded-xl text-base"
            required
          />
        </Field>
        <Field
          label="Nome de usuário"
          hint={
            check === 'taken'
              ? 'Já existe. Tente outro.'
              : check === 'invalid'
                ? SIGNUP_ERR.username
                : 'É como você aparece no chat: seu nome real ou um apelido.'
          }
          bad={check === 'taken' || check === 'invalid'}
        >
          <div className="relative">
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value.slice(0, 24))}
              autoComplete="nickname"
              className="h-11 rounded-xl pr-10 text-base"
              required
            />
            <span className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground" aria-hidden>
              {check === 'busy' ? <Loader2 className="size-4 animate-spin" /> : check === 'ok' ? <Check className="size-4 text-emerald-500" /> : null}
            </span>
          </div>
        </Field>
      </div>
      <Button type="submit" disabled={!ok || busy} className="mt-5 h-12 w-full rounded-full text-[15px] font-semibold">
        {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Entrar no chat'}
      </Button>
      <p className="mt-2.5 text-center text-[11px] leading-snug text-muted-foreground">
        Ao entrar você aceita os{' '}
        <a href="/termos" target="_blank" className="underline underline-offset-2">
          termos
        </a>{' '}
        e a{' '}
        <a href="/privacidade" target="_blank" className="underline underline-offset-2">
          política de privacidade
        </a>
        .
      </p>
    </form>
  );
}

function Field({ label, hint, bad, children }: { label: string; hint?: string; bad?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium">{label}</span>
      {children}
      {hint && <span className={cn('mt-1 block text-[11.5px] leading-snug', bad ? 'font-medium text-destructive' : 'text-muted-foreground')}>{hint}</span>}
    </label>
  );
}
