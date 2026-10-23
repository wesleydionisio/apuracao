// Tema claro/escuro pela classe .dark no <html> (definida antes do paint em index.html).
import { useEffect, useState } from 'react';

const isDark = () => document.documentElement.classList.contains('dark');

/** acompanha a classe .dark (troca manual, ou do sistema quando não há escolha salva) */
export function useIsDark(): boolean {
  const [dark, setDark] = useState(isDark);
  useEffect(() => {
    const mo = new MutationObserver(() => setDark(isDark()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    // sem escolha salva, segue o sistema ao vivo
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      let saved: string | null = null;
      try {
        saved = localStorage.getItem('theme');
      } catch {
        /* sem storage */
      }
      if (!saved) document.documentElement.classList.toggle('dark', mq.matches);
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
  document.documentElement.classList.toggle('dark', t === 'dark');
  try {
    localStorage.setItem('theme', t);
  } catch {
    /* sem storage */
  }
  const meta = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
  meta.forEach((m) => (m.content = t === 'dark' ? '#0f1216' : '#f5f6f8'));
}
