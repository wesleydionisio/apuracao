import { useEffect, useState } from 'react';

export function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(q).matches);
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setOn(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return on;
}

/** teclado virtual aberto (classe html.kb, definida pelo App a partir do visualViewport) */
export function useKeyboardOpen(): boolean {
  const [kb, setKb] = useState(() => document.documentElement.classList.contains('kb'));
  useEffect(() => {
    const el = document.documentElement;
    const mo = new MutationObserver(() => setKb(el.classList.contains('kb')));
    mo.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, []);
  return kb;
}
