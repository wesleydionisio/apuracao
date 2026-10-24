// Polling com setTimeout encadeado: nunca duas requisições em voo (resposta lenta não empilha), mais lento ou
// parado com a aba oculta e uma busca na hora ao voltar para a aba, se a última já tem mais de 10 s.
export interface PollOpts {
  /** com a aba oculta: multiplica o intervalo (padrão 3) ou 'pause' */
  hidden?: number | 'pause';
  /** sorteio extra sobre o intervalo (0.33 → ms a ms×1,33): espalha quem abriu a página junto */
  jitter?: number;
  /** busca já ao começar (padrão true) */
  now?: boolean;
  /** espera depois de uma falha (padrão: o intervalo normal) */
  retry?: number;
}

export function poll(load: () => Promise<unknown>, ms: number, o: PollOpts = {}): () => void {
  const { hidden = 3, jitter = 0, now = true, retry } = o;
  let alive = true;
  let busy = false;
  let last = 0;
  let t: ReturnType<typeof setTimeout> | undefined;
  const isHidden = () => document.visibilityState === 'hidden';
  const wait = () => {
    if (isHidden() && hidden === 'pause') return null;
    return ms * (isHidden() ? (hidden as number) : 1) * (1 + Math.random() * jitter);
  };
  const next = (w = wait()) => {
    clearTimeout(t);
    if (alive && !busy && w !== null) t = setTimeout(run, w);
  };
  async function run() {
    clearTimeout(t);
    if (!alive || busy) return;
    busy = true;
    let failed = false;
    try {
      await load();
    } catch {
      // fica com o último dado; tenta de novo no próximo
      failed = true;
    }
    busy = false;
    last = Date.now();
    next(failed && retry && !isHidden() ? retry * (1 + Math.random() * jitter) : wait());
  }
  const onVis = () => {
    if (isHidden()) return next();
    const age = Date.now() - last;
    if (age >= Math.min(ms, 10_000)) run();
    else next(ms - age);
  };
  document.addEventListener('visibilitychange', onVis);
  if (now) run();
  else next();
  return () => {
    alive = false;
    clearTimeout(t);
    document.removeEventListener('visibilitychange', onVis);
  };
}
