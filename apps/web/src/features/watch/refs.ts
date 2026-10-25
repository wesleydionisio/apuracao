// Referências ligadas/desligadas pelo usuário, compartilhadas com o Painel.
// localStorage 'refs' = { t1, y22, chart, proj } — campos desconhecidos são preservados ao gravar.
import { useCallback, useEffect, useState } from 'react';

export interface Refs {
  /** 1º turno 2026 */
  t1: boolean;
  /** 2º turno 2022 */
  y22: boolean;
  /** gráfico aberto na tela Ao vivo */
  chart: boolean;
  /** projeção no gráfico (caminho até 100% e faixa) */
  proj: boolean;
}

const KEY = 'refs';
const EVT = 'refs-change';
// 2022 ligado de saída: a curva e a virada de 2022 são a referência principal da noite
const DEFAULTS: Refs = { t1: false, y22: true, chart: false, proj: true };

function load(): Record<string, unknown> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function readRefs(): Refs {
  const raw = load();
  return {
    t1: typeof raw.t1 === 'boolean' ? raw.t1 : DEFAULTS.t1,
    y22: typeof raw.y22 === 'boolean' ? raw.y22 : DEFAULTS.y22,
    chart: typeof raw.chart === 'boolean' ? raw.chart : DEFAULTS.chart,
    proj: typeof raw.proj === 'boolean' ? raw.proj : DEFAULTS.proj,
  };
}

export function useRefs(): [Refs, (patch: Partial<Refs>) => void] {
  const [refs, setRefs] = useState<Refs>(readRefs);
  useEffect(() => {
    const sync = () => setRefs(readRefs());
    window.addEventListener(EVT, sync);
    // outra aba (ou o Painel) mudou
    const onStorage = (e: StorageEvent) => e.key === KEY && sync();
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  const update = useCallback((patch: Partial<Refs>) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...load(), ...patch }));
    } catch {
      /* sem storage: vale só para esta tela */
    }
    setRefs((cur) => ({ ...cur, ...patch }));
    window.dispatchEvent(new Event(EVT));
  }, []);
  return [refs, update];
}
