// /data/site.json: patrocínio do topo, WhatsApp do "anuncie aqui" e se há Super Chat. Editado no /admin.
// A última versão fica no aparelho: na próxima visita a faixa do topo já nasce certa (sem pular o layout).
import { DEFAULT_SITE, type SiteConfig } from '@apuracao/shared';
import { create } from 'zustand';
import { getJSON } from './api';
import { poll } from './poll';

const LS = 'site';

function saved(): SiteConfig {
  try {
    const raw = localStorage.getItem(LS);
    if (raw) return { ...DEFAULT_SITE, ...JSON.parse(raw) };
  } catch {
    /* sem storage */
  }
  return DEFAULT_SITE;
}

export const useSite = create<{ site: SiteConfig }>(() => ({ site: saved() }));

let started = false;

export function startSite() {
  if (started) return;
  started = true;
  const load = () =>
    getJSON<SiteConfig>('/data/site.json', { cache: 'no-cache' }).then((s) => {
      const site = { ...DEFAULT_SITE, ...s };
      useSite.setState({ site });
      try {
        localStorage.setItem(LS, JSON.stringify(site));
      } catch {
        /* sem storage */
      }
    });
  poll(load, 60_000);
}
