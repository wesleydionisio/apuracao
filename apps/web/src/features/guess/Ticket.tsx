// Formulário de palpite como "ticket": um número principal, ajuste fino, detalhes opcionais.
import type { Board, Municipality } from '@apuracao/shared';
import { UFS } from '@apuracao/shared';
import { ChartColumn, ChevronRight, Clock, Lock, MapPin, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { candOf } from '@/components/core/candidate';
import { toast, useNow } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, HttpError } from '@/lib/api';
import { fmtInt } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useBoard } from '@/store/board';
import { countdown } from './bits';
import { CityPicker } from './CityPicker';
import { GuessHistogram, useGuessHist } from './Histogram';
import { PctSlider } from './PctSlider';

export const MY_GUESS = 'my-guess';

export function myGuessId(): string | null {
  try {
    return localStorage.getItem(MY_GUESS);
  } catch {
    return null;
  }
}

export function guessesOpen(board: Board | null, now = Date.now()) {
  return !!board && now < Date.parse(board.releaseAt);
}

const UF_LIST = Object.entries(UFS).filter(([k]) => k !== 'ZZ');
const two = (n: number) => String(n).padStart(2, '0');

export function GuessTicket({ board }: { board: Board }) {
  const me = useBoard((s) => s.me);
  const stats = useBoard((s) => s.stats);
  const [, nav] = useLocation();
  const now = useNow(1000);
  const [pa, setPa] = useState(50);
  const [nick, setNick] = useState('');
  const [uf, setUf] = useState('');
  const [ufPa, setUfPa] = useState(50);
  const [mun, setMun] = useState<Municipality | null>(null);
  const [munPa, setMunPa] = useState(50);
  const [cityOpen, setCityOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const hist = useGuessHist();
  useEffect(() => {
    if (me && !nick) setNick(me.nick);
  }, [me, nick]);

  const ca = candOf(board, 'a');
  const cb = candOf(board, 'b');
  const mine = myGuessId();
  if (!ca || !cb) return null;

  if (!guessesOpen(board, now)) {
    return (
      <section className="rounded-2xl border bg-card p-5">
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Lock className="size-4" aria-hidden />
          Palpites encerrados
        </div>
        <p className="mt-2 text-[17px] font-semibold leading-snug text-balance">Os palpites fecharam às 17h, quando a apuração começou.</p>
        {mine ? (
          <Button size="lg" className="mt-4 h-12 w-full rounded-xl text-[15px]" onClick={() => nav(`/p/${mine}`)}>
            Ver meu palpite e meu ranking
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        ) : (
          <p className="mt-2 text-[13px] text-muted-foreground">
            {stats?.guesses ? `${fmtInt(stats.guesses)} pessoas palpitaram. ` : ''}Acompanhe o resultado no placar.
          </p>
        )}
      </section>
    );
  }

  const left = countdown(Date.parse(board.releaseAt) - now);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const { guess } = await api.postGuess({
        nick: nick.trim() || me?.nick || 'Anônimo',
        pa,
        uf: uf || mun?.uf || null,
        ufPa: uf ? ufPa : null,
        mun: mun?.ibge ?? null,
        munPa: mun ? munPa : null,
      });
      try {
        localStorage.setItem(MY_GUESS, guess.id);
      } catch {
        /* sem storage */
      }
      nav(`/p/${guess.id}`);
    } catch (err) {
      const code = err instanceof HttpError ? err.code : undefined;
      toast(code === 'closed' ? 'Palpites encerrados' : code === 'rate' ? 'Calma! Tente de novo em instantes' : 'Não deu para salvar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="overflow-hidden rounded-2xl border bg-card">
      <header className="px-5 pt-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[17px] font-semibold leading-tight">{mine ? 'Atualize seu palpite' : 'Seu palpite para o 2º turno'}</h2>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground" title="Palpites fecham às 17h de domingo">
          <Clock className="size-3" aria-hidden />
          <span className="num">
            {left.d ? `${left.d}d ` : ''}
            {two(left.h)}:{two(left.m)}:{two(left.s)}
          </span>
        </span>
        </div>
        <p className="mt-1 text-[13px] text-muted-foreground">Resultado final no Brasil, em % dos votos válidos</p>
      </header>

      <div className="px-5 pt-5 pb-4">
        <PctSlider value={pa} onChange={setPa} ca={ca} cb={cb} label={`Percentual final de ${ca.short} no Brasil`} />
      </div>

      {hist && hist.total > 0 && (
        <div className="border-t px-5 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[13px] font-medium">
              <ChartColumn className="size-4 text-muted-foreground" aria-hidden />
              Onde estão os palpites
            </span>
            <span className="text-[11px] text-muted-foreground">a linha é você</span>
          </div>
          <GuessHistogram hist={hist} ca={ca} cb={cb} mine={pa} />
        </div>
      )}

      <div className="divide-y border-y">
        <div className="px-5 py-4">
          <Label htmlFor="g-uf" className="text-[13px] font-medium">
            No seu estado <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <Select value={uf || 'none'} onValueChange={(v) => setUf(v === 'none' ? '' : v)}>
            <SelectTrigger id="g-uf" className="mt-2 h-11 w-full rounded-xl">
              <SelectValue placeholder="Escolha o estado" />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="none">Não palpitar no estado</SelectItem>
              {UF_LIST.map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {uf && (
            <div className="mt-4 animate-in fade-in-0 slide-in-from-top-1">
              <PctSlider value={ufPa} onChange={setUfPa} ca={ca} cb={cb} size="sm" label={`Percentual de ${ca.short} em ${UFS[uf]}`} />
            </div>
          )}
        </div>

        <div className="px-5 py-4">
          <div className="text-[13px] font-medium">
            Na sua cidade <span className="font-normal text-muted-foreground">(opcional)</span>
          </div>
          {mun ? (
            <div className="mt-2 flex h-11 items-center gap-2 rounded-xl border bg-background pr-1 pl-3">
              <MapPin className="size-4 text-muted-foreground" aria-hidden />
              <span className="flex-1 truncate text-[14px] font-medium">
                {mun.name} <span className="font-normal text-muted-foreground">{mun.uf}</span>
              </span>
              <Button type="button" variant="ghost" size="icon" className="size-9" onClick={() => setMun(null)} aria-label="Remover cidade">
                <X className="size-4" />
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCityOpen(true)}
              className="mt-2 flex h-11 w-full items-center gap-2 rounded-xl border bg-background px-3 text-left text-[14px] text-muted-foreground transition-colors hover:bg-accent"
            >
              <MapPin className="size-4" aria-hidden />
              <span className="flex-1">Buscar sua cidade</span>
              <ChevronRight className="size-4" aria-hidden />
            </button>
          )}
          {mun && (
            <div className="mt-4 animate-in fade-in-0 slide-in-from-top-1">
              <PctSlider value={munPa} onChange={setMunPa} ca={ca} cb={cb} size="sm" label={`Percentual de ${ca.short} em ${mun.name}`} />
            </div>
          )}
        </div>

        <div className="px-5 py-4">
          <Label htmlFor="g-nick" className="text-[13px] font-medium">
            Apelido no card
          </Label>
          <Input
            id="g-nick"
            value={nick}
            onChange={(e) => setNick(e.target.value.slice(0, 24))}
            maxLength={24}
            autoComplete="nickname"
            className="mt-2 h-11 rounded-xl"
          />
          <p className="mt-1.5 text-[12px] text-muted-foreground">Não precisa ser seu nome real.</p>
        </div>
      </div>

      <div className="space-y-2 px-5 pt-4 pb-5">
        <Button type="submit" size="lg" disabled={busy} className={cn('h-12 w-full rounded-xl text-[15px] font-semibold', busy && 'opacity-70')}>
          {busy ? 'Salvando…' : mine ? 'Atualizar palpite' : 'Cravar palpite e gerar meu card'}
        </Button>
        <p className="text-center text-[12px] text-muted-foreground">
          Um palpite por aparelho. Dá para mudar até as 17h de domingo.
          {stats?.guesses ? (
            <span className="block">
              <span className="num">{fmtInt(stats.guesses)}</span> palpites feitos
            </span>
          ) : null}
        </p>
      </div>

      <CityPicker
        open={cityOpen}
        onOpenChange={setCityOpen}
        onPick={(m) => {
          setMun(m);
          if (!uf) setUf(m.uf);
        }}
      />
    </form>
  );
}
