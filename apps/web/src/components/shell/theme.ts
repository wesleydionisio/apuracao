// Tema claro/escuro pelo atributo data-theme no <html> (definido antes do paint em index.html).
import { useEffect, useState } from 'react';

const isDark = () => document.documentElement.dataset.theme === 'dark';
const apply = (dark: boolean) => (document.documentElement.dataset.theme = dark ? 'dark' : 'light');

/** acompanha o data-theme (troca manual, ou do sistema quando não há escolha salva) */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    // sem escolha salva, segue o sistema ao vivo
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem('theme');
      } catch {
        /* sem storage */
      }
      if (!saved) apply(mq.matches);
    };
    mq.addEventListener('change', onSystem);
    return () => {
      mo.disconnect();
      mq.removeEventListener('change', onSystem);
    };
  }, []);
  return dark;
}

export function setTheme(t: 'dark' | 'light') {
  apply(t === 'dark');
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* sem storage */
  }
  const meta = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  meta.forEach((m) => (m.content = t === 'dark' ? '#0f1216' : '#f5f6f8'));
}
