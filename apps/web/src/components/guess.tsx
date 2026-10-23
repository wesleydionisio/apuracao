import type { Board, Municipality } from '@apuracao/shared';
import { UFS } from '@apuracao/shared';
import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { api, HttpError } from '../lib/api';
import { fmtPct } from '../lib/format';
import { candOf, useBoard } from '../store/board';
import { CitySearch } from './city-search';
import { countdownParts } from './chrome';
import { Card, Title, toast, useNow } from './ui';

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

function PctSlider({
  value,
  onChange,
  board,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  board: Board;
  label: string;
}) {
  const ca = candOf(board, 'a')!;
  const cb = candOf(board, 'b')!;
  const set = (v: number) => onChange(Math.round(Math.max(0, Math.min(100, v)) * 10) / 10);
  return (
    <div>
      <div className="mb-2 text-[13px] text-muted">{label}</div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-[13px] font-semibold" style={{ color: ca.color }}>{ca.short}</div>
          <div className="display text-[34px] font-extrabold leading-none">{fmtPct(value, 1)}%</div>
        </div>
        <div className="text-right">
          <div className="text-[13px] font-semibold" style={{ color: cb.color }}>{cb.short}</div>
          <div className="display text-[34px] font-extrabold leading-none">{fmtPct(100 - value, 1)}%</div>
        </div>
      </div>
      <input
        type="range"
        min={35}
        max={65}
        step={0.1}
        value={value}
        onChange={(e) => set(Number(e.target.value))}
        className="mt-3 h-10 w-full"
        style={{ accentColor: value >= 50 ? ca.color : cb.color }}
        aria-label={`Percentual de ${ca.short}`}
      />
      <div className="mt-1 flex items-center justify-center gap-2">
        {[-1, -0.1].map((d) => (
          <button key={d} type="button" onClick={() => set(value + d)} className="num h-11 min-w-14 rounded-xl border border-line bg-card px-3 text-[14px] font-semibold">
            {d > 0 ? '+' : '−'}{fmtPct(Math.abs(d), 1)}
          </button>
        ))}
        <button type="button" onClick={() => set(50)} className="h-11 rounded-xl border border-line bg-card px-3 text-[13px]">50/50</button>
        {[0.1, 1].map((d) => (
          <button key={d} type="button" onClick={() => set(value + d)} className="num h-11 min-w-14 rounded-xl border border-line bg-card px-3 text-[14px] font-semibold">
            +{fmtPct(d, 1)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function GuessForm({ board }: { board: Board }) {
  const me = useBoard((s) => s.me);
  const [, nav] = useLocation();
  const now = useNow(1000);
  const [pa, setPa] = useState(50);
  const [nick, setNick] = useState('');
  const [more, setMore] = useState(false);
  const [uf, setUf] = useState('');
  const [ufPa, setUfPa] = useState(50);
  const [mun, setMun] = useState<Municipality | null>(null);
  const [munPa, setMunPa] = useState(50);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (me && !nick) setNick(me.nick);
  }, [me, nick]);

  const open = guessesOpen(board, now);
  const mine = myGuessId();
  if (!open) {
    return (
      <Card>
        <Title>Palpites encerrados</Title>
        <p className="text-[14px] text-muted">Os palpites fecharam às 17h, quando a apuração começou.</p>
        {mine && (
          <button onClick={() => nav(`/p/${mine}`)} className="mt-3 min-h-11 w-full rounded-xl bg-fg px-4 font-semibold text-bg">
            Ver meu palpite ao vivo
          </button>
        )}
      </Card>
    );
  }

  const left = countdownParts(Date.parse(board.releaseAt) - now);

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
    <Card>
      <Title right={<span className="num text-[11px] text-muted">fecha em {left.d ? `${left.d}d ` : ''}{left.h}h{String(left.m).padStart(2, '0')}</span>}>
        {mine ? 'Atualize seu palpite' : 'Qual vai ser o resultado?'}
      </Title>
      <form onSubmit={submit} className="space-y-5">
        <PctSlider value={pa} onChange={setPa} board={board} label="Resultado final no Brasil (votos válidos)" />

        {!more ? (
          <button type="button" onClick={() => setMore(true)} className="min-h-11 w-full rounded-xl border border-dashed border-line text-[14px] text-muted">
            + Palpitar também no meu estado e na minha cidade
          </button>
        ) : (
          <div className="space-y-5 rounded-xl bg-soft p-3">
            <label className="block">
              <span className="mb-1 block text-[13px] text-muted">Seu estado</span>
              <select value={uf} onChange={(e) => setUf(e.target.value)} className="h-12 w-full rounded-xl border border-line bg-card px-3">
                <option value="">Não quero palpitar no estado</option>
                {Object.entries(UFS)
                  .filter(([k]) => k !== 'ZZ')
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </label>
            {uf && <PctSlider value={ufPa} onChange={setUfPa} board={board} label={`Resultado em ${UFS[uf]}`} />}
            <div>
              <span className="mb-1 block text-[13px] text-muted">Sua cidade</span>
              {mun ? (
                <div className="flex items-center justify-between rounded-xl border border-line bg-card px-3 py-2">
                  <span className="text-[14px] font-medium">
                    {mun.name} <span className="text-muted">({mun.uf})</span>
                  </span>
                  <button type="button" onClick={() => setMun(null)} className="min-h-11 px-2 text-[13px] text-muted underline">
                    trocar
                  </button>
                </div>
              ) : (
                <CitySearch onPick={(m) => { setMun(m); if (!uf) setUf(m.uf); }} placeholder="Buscar sua cidade" compact />
              )}
            </div>
            {mun && <PctSlider value={munPa} onChange={setMunPa} board={board} label={`Resultado em ${mun.name}`} />}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-[13px] text-muted">Apelido no card (sem nome real, se preferir)</span>
          <input
            value={nick}
            onChange={(e) => setNick(e.target.value.slice(0, 24))}
            maxLength={24}
            className="h-12 w-full rounded-xl border border-line bg-card px-3"
            autoComplete="nickname"
          />
        </label>
        <button disabled={busy} className="min-h-12 w-full rounded-xl bg-fg text-[16px] font-bold text-bg press disabled:opacity-60">
          {busy ? 'Salvando…' : mine ? 'Atualizar palpite' : 'Cravar palpite e gerar card'}
        </button>
        <p className="text-center text-[11px] text-muted">Um palpite por aparelho. Dá para mudar até as 17h de domingo.</p>
      </form>
    </Card>
  );
}
