// /admin — painel enxuto: carga do servidor, usuários, Super Chats e o patrocínio do topo.
// O token (ADMIN_TOKEN do .env) fica só nesta aba (sessionStorage) e vai no cabeçalho x-admin-token.
import type { ScStatus, SiteConfig } from '@apuracao/shared';
import { fmtBrl, scTier, waLink } from '@apuracao/shared';
import { Check, EyeOff, LogOut, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Logo } from '@/components/shell/bits';
import { setTheme, useIsDark } from '@/components/shell/theme';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { fmtInt } from '@/lib/format';
import { cn } from '@/lib/utils';

const TOKEN = 'admin-token';

interface Worker {
  url: string;
  ok: boolean;
  worker?: string;
  conns?: number;
  inRate?: number | null;
  outRate?: number | null;
  heapMb?: number | null;
  chat?: number | null;
  blocked?: number | null;
  slowRooms?: number | null;
  aiOn?: boolean;
  aiCircuitOpen?: boolean;
}

interface Totals {
  count: number;
  cents: number;
  pending: number;
}

interface Overview {
  at: string;
  host: { load: number[]; cpus: number; memTotal: number; memFree: number; uptime: number };
  api: { rss: number; heap: number; uptime: number };
  redis: boolean | null;
  ws: Worker[];
  board: { released: boolean; pst: number | null; ageS: number; status: string | null } | null;
  users: {
    online: number;
    accounts: number;
    accountsDay: number;
    guesses: number;
    guessesLastHour: number;
    recent: { username: string; name: string; email: string; createdAt: string }[];
  };
  superchat: { provider: 'mp' | 'manual' | 'dev' | null; today: Totals; all: Totals };
}

interface ScRow {
  id: string;
  room: string;
  username: string;
  body: string;
  amount: number;
  status: ScStatus;
  provider: string;
  createdAt: string;
  paidAt: string | null;
}

type SiteForm = Omit<SiteConfig, 'superchat'>;

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN) ?? '';
  } catch {
    return '';
  }
}

class AuthError extends Error {}

async function adminFetch<T>(path: string, token: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'x-admin-token': token, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  if (r.status === 401) throw new AuthError();
  if (r.status === 429) throw new Error('Muitas tentativas. Espere um minuto.');
  if (!r.ok) throw new Error(`Erro ${r.status}`);
  return r.json() as Promise<T>;
}

const gb = (b: number) => `${(b / 1024 ** 3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
const mb = (b: number) => `${Math.round(b / 1024 ** 2)} MB`;
const dur = (s: number) => (s < 3600 ? `${Math.round(s / 60)} min` : s < 86400 ? `${(s / 3600).toFixed(1)} h` : `${Math.floor(s / 86400)} d`);
const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '—';

export default function AdminPage() {
  const [token, setToken] = useState(readToken);
  const logout = useCallback(() => {
    try {
      sessionStorage.removeItem(TOKEN);
    } catch {
      /* sem storage */
    }
    setToken('');
  }, []);
  useEffect(() => {
    document.title = 'Admin · Apuração';
  }, []);
  return token ? <Dashboard token={token} onLogout={logout} /> : <Login onToken={setToken} />;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [t, setT] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-4">
      <form
        className="w-full max-w-xs rounded-2xl border bg-card p-5"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          try {
            await adminFetch('/api/admin/site', t);
            try {
              sessionStorage.setItem(TOKEN, t);
            } catch {
              /* sem storage: vale só enquanto a tela estiver aberta */
            }
            onToken(t);
          } catch (e2) {
            setErr(e2 instanceof AuthError ? 'Token inválido.' : (e2 as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-2">
          <Logo className="size-6" />
          <h1 className="text-[16px] font-semibold">Painel admin</h1>
        </div>
        <label className="mt-4 block text-[12.5px] font-medium">
          Token
          <Input type="password" value={t} onChange={(e) => setT(e.target.value)} autoComplete="current-password" className="mt-1 h-11 rounded-xl" autoFocus />
        </label>
        {err && (
          <p className="mt-2 text-[12.5px] font-medium text-destructive" role="alert">
            {err}
          </p>
        )}
        <Button type="submit" disabled={!t || busy} className="mt-4 h-11 w-full rounded-xl">
          Entrar
        </Button>
      </form>
    </div>
  );
}

function Dashboard({ token, onLogout }: { token: string; onLogout: () => void }) {
  const [ov, setOv] = useState<Overview | null>(null);
  const [scs, setScs] = useState<ScRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dark = useIsDark();

  const load = useCallback(async () => {
    try {
      const [o, s] = await Promise.all([adminFetch<Overview>('/api/admin/overview', token), adminFetch<ScRow[]>('/api/admin/superchats', token)]);
      setOv(o);
      setScs(s);
      setErr(null);
    } catch (e) {
      if (e instanceof AuthError) return onLogout();
      setErr((e as Error).message);
    }
  }, [token, onLogout]);

  useEffect(() => {
    void load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/85 backdrop-blur-xl">
        <div className="mx-auto flex h-13 max-w-6xl items-center gap-2 px-4">
          <Logo className="size-6" />
          <span className="text-[16px] font-semibold">Admin</span>
          <span className="num ml-2 hidden text-[12px] text-muted-foreground sm:inline">{ov ? `atualizado ${when(ov.at)}` : 'carregando…'}</span>
          {err && <span className="ml-2 truncate text-[12px] font-medium text-destructive">{err}</span>}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="icon" className="size-10 rounded-full" onClick={() => void load()} aria-label="Atualizar">
              <RefreshCw className="size-4" />
            </Button>
            <Button variant="ghost" size="sm" className="h-10 rounded-full" onClick={() => setTheme(dark ? 'light' : 'dark')}>
              {dark ? 'Claro' : 'Escuro'}
            </Button>
            <Button variant="ghost" size="icon" className="size-10 rounded-full" onClick={onLogout} aria-label="Sair">
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl space-y-4 px-4 py-4">
        {ov && <Kpis ov={ov} />}
        <div className="grid gap-4 lg:grid-cols-2">
          {ov && <Server ov={ov} />}
          {ov && <Users ov={ov} />}
        </div>
        <Superchats rows={scs} provider={ov?.superchat.provider ?? null} token={token} onChange={load} />
        <SponsorForm token={token} />
      </main>
    </div>
  );
}

function Section({ title, right, children, className }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border bg-card p-4', className)}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'ok' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-2xl border bg-card px-4 py-3">
      <div className="text-[11.5px] font-medium text-muted-foreground">{label}</div>
      <div className={cn('num mt-0.5 text-[24px] font-semibold tracking-tight', tone === 'warn' && 'text-[var(--warning)]', tone === 'bad' && 'text-destructive')}>
        {value}
      </div>
      {sub && <div className="num text-[11.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Kpis({ ov }: { ov: Overview }) {
  const load = ov.host.load[0] / ov.host.cpus;
  const memUsed = 1 - ov.host.memFree / ov.host.memTotal;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Kpi label="Online agora" value={fmtInt(ov.users.online)} sub={`${ov.ws.filter((w) => w.ok).length}/${ov.ws.length} workers WS no ar`} />
      <Kpi
        label="Carga da CPU (1 min)"
        value={`${Math.round(load * 100)}%`}
        sub={`load ${ov.host.load.map((x) => x.toFixed(2)).join(' · ')} · ${ov.host.cpus} vCPU`}
        tone={load > 0.9 ? 'bad' : load > 0.7 ? 'warn' : 'ok'}
      />
      <Kpi label="Memória" value={`${Math.round(memUsed * 100)}%`} sub={`${gb(ov.host.memTotal - ov.host.memFree)} de ${gb(ov.host.memTotal)}`} tone={memUsed > 0.9 ? 'bad' : memUsed > 0.8 ? 'warn' : 'ok'} />
      <Kpi
        label="Super Chat hoje"
        value={fmtBrl(ov.superchat.today.cents)}
        sub={`${ov.superchat.today.count} pagos · ${ov.superchat.today.pending} aguardando`}
      />
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1.5 text-[13px] last:border-0">
      <span className="text-muted-foreground">{k}</span>
      <span className="num text-right font-medium">{v}</span>
    </div>
  );
}

const Dot = ({ ok }: { ok: boolean | null }) => (
  <span className={cn('inline-block size-2 rounded-full', ok === null ? 'bg-muted-foreground/40' : ok ? 'bg-[var(--live)]' : 'bg-destructive')} aria-hidden />
);

function Server({ ov }: { ov: Overview }) {
  return (
    <Section title="Servidor">
      <Row k="Redis" v={<span className="inline-flex items-center gap-1.5"><Dot ok={ov.redis} />{ov.redis === null ? 'desligado (dev)' : ov.redis ? 'ok' : 'fora'}</span>} />
      <Row
        k="Placar"
        v={
          ov.board ? (
            <span className={cn(ov.board.ageS > 60 && 'text-destructive')}>
              {ov.board.released ? `${ov.board.pst?.toLocaleString('pt-BR')}% apurado` : 'antes das 17h'} · gerado há {ov.board.ageS}s
            </span>
          ) : (
            'sem br.json'
          )
        }
      />
      <Row k="API" v={`${mb(ov.api.rss)} · no ar há ${dur(ov.api.uptime)}`} />
      <Row k="Máquina" v={`no ar há ${dur(ov.host.uptime)}`} />
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">Worker</th>
              <th className="py-1 pr-2 text-right font-medium">Conexões</th>
              <th className="py-1 pr-2 text-right font-medium">Entrada/s</th>
              <th className="py-1 pr-2 text-right font-medium">Saída/s</th>
              <th className="py-1 pr-2 text-right font-medium">Heap</th>
              <th className="py-1 text-right font-medium">Moderação IA</th>
            </tr>
          </thead>
          <tbody className="num">
            {ov.ws.map((w) => (
              <tr key={w.url} className="border-t">
                <td className="py-1.5 pr-2">
                  <span className="inline-flex items-center gap-1.5">
                    <Dot ok={w.ok} />
                    {w.worker ?? w.url}
                  </span>
                </td>
                <td className="py-1.5 pr-2 text-right">{w.ok ? fmtInt(w.conns ?? 0) : '—'}</td>
                <td className="py-1.5 pr-2 text-right">{w.inRate?.toFixed(1) ?? '—'}</td>
                <td className="py-1.5 pr-2 text-right">{w.outRate?.toFixed(0) ?? '—'}</td>
                <td className="py-1.5 pr-2 text-right">{w.heapMb != null ? `${Math.round(w.heapMb)} MB` : '—'}</td>
                <td className="py-1.5 text-right">{!w.ok ? '—' : !w.aiOn ? 'só filtro' : w.aiCircuitOpen ? 'disjuntor aberto' : 'ok'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Users({ ov }: { ov: Overview }) {
  const u = ov.users;
  return (
    <Section title="Usuários">
      <Row k="Contas (login com Google)" v={`${fmtInt(u.accounts)} · +${fmtInt(u.accountsDay)} em 24h`} />
      <Row k="Palpites" v={`${fmtInt(u.guesses)} · +${fmtInt(u.guessesLastHour)} na última hora`} />
      <h3 className="mt-3 mb-1 text-[12px] font-medium text-muted-foreground">Contas mais novas</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <tbody>
            {u.recent.map((a) => (
              <tr key={a.username} className="border-t">
                <td className="py-1.5 pr-2 font-medium">{a.username}</td>
                <td className="max-w-[10rem] truncate py-1.5 pr-2 text-muted-foreground">{a.name}</td>
                <td className="max-w-[12rem] truncate py-1.5 pr-2 text-muted-foreground">{a.email}</td>
                <td className="num py-1.5 text-right text-muted-foreground">{when(a.createdAt)}</td>
              </tr>
            ))}
            {!u.recent.length && (
              <tr>
                <td className="py-2 text-muted-foreground">Nenhuma conta ainda.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

const STATUS: Record<ScStatus, { label: string; cls: string }> = {
  paid: { label: 'pago', cls: 'bg-[var(--live)]/15 text-[var(--live)]' },
  pending: { label: 'aguardando', cls: 'bg-[var(--warning)]/15 text-[var(--warning)]' },
  expired: { label: 'expirado', cls: 'bg-muted text-muted-foreground' },
  hidden: { label: 'oculto', cls: 'bg-destructive/15 text-destructive' },
};

const PROVIDER: Record<string, string> = {
  mp: 'Mercado Pago (confirma sozinho)',
  manual: 'Chave Pix (confira no extrato e aprove aqui)',
  dev: 'teste local',
};

function Superchats({ rows, provider, token, onChange }: { rows: ScRow[] | null; provider: string | null; token: string; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (id: string, action: 'approve' | 'hide') => {
    if (action === 'hide' && !confirm('Tirar este Super Chat do chat? O pagamento continua registrado.')) return;
    setBusy(id);
    try {
      await adminFetch(`/api/admin/superchats/${id}`, token, { action });
      toast(action === 'approve' ? 'Super Chat publicado' : 'Super Chat ocultado');
      onChange();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section
      title="Super Chats"
      right={<span className="text-[12px] text-muted-foreground">{provider ? PROVIDER[provider] : 'desligado: configure MP_ACCESS_TOKEN ou PIX_KEY'}</span>}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="py-1 pr-2 font-medium">Quando</th>
              <th className="py-1 pr-2 font-medium">Quem</th>
              <th className="py-1 pr-2 text-right font-medium">Valor</th>
              <th className="py-1 pr-2 font-medium">Mensagem</th>
              <th className="py-1 pr-2 font-medium">Status</th>
              <th className="py-1 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {(rows ?? []).map((s) => (
              <tr key={s.id} className="border-t align-top">
                <td className="num py-1.5 pr-2 whitespace-nowrap text-muted-foreground">{when(s.paidAt ?? s.createdAt)}</td>
                <td className="py-1.5 pr-2 font-medium whitespace-nowrap">
                  {s.username}
                  {s.room !== 'br' && <span className="ml-1 text-muted-foreground">#{s.room}</span>}
                </td>
                <td className="num py-1.5 pr-2 text-right font-semibold whitespace-nowrap">
                  <span className="mr-1.5 inline-block size-2 rounded-full" style={{ background: scTier(s.amount).color }} aria-hidden />
                  {fmtBrl(s.amount)}
                </td>
                <td className="max-w-[22rem] py-1.5 pr-2 break-words">{s.body || <span className="text-muted-foreground">sem mensagem</span>}</td>
                <td className="py-1.5 pr-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS[s.status].cls)}>{STATUS[s.status].label}</span>
                </td>
                <td className="py-1 text-right whitespace-nowrap">
                  {(s.status === 'pending' || s.status === 'expired') && s.provider !== 'mp' && (
                    <Button size="sm" variant="outline" className="h-8 rounded-full" disabled={busy === s.id} onClick={() => act(s.id, 'approve')}>
                      <Check className="size-3.5" aria-hidden />
                      Pagou
                    </Button>
                  )}
                  {s.status === 'paid' && (
                    <Button size="sm" variant="ghost" className="h-8 rounded-full text-destructive hover:text-destructive" disabled={busy === s.id} onClick={() => act(s.id, 'hide')}>
                      <EyeOff className="size-3.5" aria-hidden />
                      Ocultar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {rows && !rows.length && (
              <tr>
                <td colSpan={6} className="py-3 text-muted-foreground">
                  Nenhum Super Chat ainda.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12.5px] font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11.5px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function SponsorForm({ token }: { token: string }) {
  const [f, setF] = useState<SiteForm | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminFetch<SiteForm>('/api/admin/site', token)
      .then((s) => setF({ sponsor: s.sponsor, ad: s.ad }))
      .catch(() => toast('Não deu para carregar o patrocínio'));
  }, [token]);
  if (!f) return null;
  const sp = f.sponsor;
  const setSp = (p: Partial<SiteForm['sponsor']>) => setF({ ...f, sponsor: { ...sp, ...p } });
  const setAd = (p: Partial<SiteForm['ad']>) => setF({ ...f, ad: { ...f.ad, ...p } });
  return (
    <Section title="Patrocínio no topo do site" right={<span className="text-[12px] text-muted-foreground">publica em até 1 min para todo mundo</span>}>
      <form
        className="grid gap-5 lg:grid-cols-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const s = await adminFetch<SiteForm>('/api/admin/site', token, f);
            setF({ sponsor: s.sponsor, ad: s.ad });
            toast('Salvo');
          } catch (e2) {
            toast((e2 as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="space-y-3">
          <label className="flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5">
            <span className="text-[13px] font-medium">Patrocinador ativo</span>
            <Switch checked={sp.on} onCheckedChange={(on) => setSp({ on })} />
          </label>
          <Field label="Nome">
            <Input value={sp.name} onChange={(e) => setSp({ name: e.target.value.slice(0, 40) })} className="h-10 rounded-xl" />
          </Field>
          <Field label="Texto" hint="Até 90 caracteres. Aparece numa linha só (no celular, cortado).">
            <Input value={sp.text} onChange={(e) => setSp({ text: e.target.value.slice(0, 90) })} className="h-10 rounded-xl" />
          </Field>
          <Field label="Link do patrocinador">
            <Input value={sp.url} onChange={(e) => setSp({ url: e.target.value })} placeholder="https://" inputMode="url" className="h-10 rounded-xl" />
          </Field>
          <Field label="Logo (URL da imagem, opcional)" hint="Mostrada com 18px de altura.">
            <Input value={sp.image} onChange={(e) => setSp({ image: e.target.value })} placeholder="https://" inputMode="url" className="h-10 rounded-xl" />
          </Field>
        </div>
        <div className="space-y-3">
          <p className="text-[12.5px] leading-snug text-muted-foreground">Sem patrocinador ativo, a faixa convida a anunciar e leva para o WhatsApp.</p>
          <Field label="WhatsApp (com DDD)">
            <Input value={f.ad.whatsapp} onChange={(e) => setAd({ whatsapp: e.target.value })} placeholder="11 91234-5678" inputMode="tel" className="h-10 rounded-xl" />
          </Field>
          <Field label="Texto do convite">
            <Input value={f.ad.text} onChange={(e) => setAd({ text: e.target.value.slice(0, 90) })} className="h-10 rounded-xl" />
          </Field>
          {f.ad.whatsapp && (
            <a href={waLink(f.ad.whatsapp)} target="_blank" rel="noopener" className="block text-[12px] text-muted-foreground underline underline-offset-2">
              Testar o link do WhatsApp
            </a>
          )}
          <Button type="submit" disabled={busy} className="mt-2 h-11 w-full rounded-xl">
            Salvar e publicar
          </Button>
        </div>
      </form>
    </Section>
  );
}
