// Modo demo: ?mock=1 usa as fixtures de apps/web/dev-fixtures (só em dev). ?pre=1 simula antes das 19h.
function flag(name: string): boolean {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has(name)) {
      const on = q.get(name) !== '0';
      sessionStorage.setItem(`flag:${name}`, on ? '1' : '0');
      return on;
    }
    return sessionStorage.getItem(`flag:${name}`) === '1';
  } catch {
    return false;
  }
}

export const MOCK = import.meta.env.DEV && flag('mock');
export const MOCK_PRE = MOCK && flag('pre');
export const TSE_URL = 'https://resultados.tse.jus.br/';
