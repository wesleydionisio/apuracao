// Configuração do site editada no painel admin (patrocínio do topo, WhatsApp do "anuncie aqui").
// Fica em var/site-config.json e sai publicada em DATA_DIR/site.json, que a CDN serve como o placar.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_SITE, type SiteConfig } from '@apuracao/shared';

type Editable = Omit<SiteConfig, 'superchat'>;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** só http(s): o link vai direto para um <a href> */
const url = (v: unknown) => {
  const s = str(v, 500);
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : '';
  } catch {
    return '';
  }
};

export function cleanSite(b: Record<string, any>, prev: Editable): Editable {
  const sp = b.sponsor ?? {};
  const ad = b.ad ?? {};
  return {
    sponsor: {
      on: typeof sp.on === 'boolean' ? sp.on : prev.sponsor.on,
      name: str(sp.name ?? prev.sponsor.name, 40),
      text: str(sp.text ?? prev.sponsor.text, 90),
      url: sp.url === undefined ? prev.sponsor.url : url(sp.url),
      image: sp.image === undefined ? prev.sponsor.image : url(sp.image),
    },
    ad: {
      whatsapp: (ad.whatsapp === undefined ? prev.ad.whatsapp : str(ad.whatsapp, 20)).replace(/\D/g, ''),
      text: str(ad.text ?? prev.ad.text, 90) || DEFAULT_SITE.ad.text,
    },
  };
}

export class Site {
  private file: string;
  private out: string;
  cfg: Editable;

  constructor(varDir: string, dataDir: string, adWhatsapp: string) {
    this.file = path.join(varDir, 'site-config.json');
    this.out = path.join(dataDir, 'site.json');
    const base: Editable = { sponsor: DEFAULT_SITE.sponsor, ad: { ...DEFAULT_SITE.ad, whatsapp: adWhatsapp.replace(/\D/g, '') } };
    let saved: Record<string, any> = {};
    try {
      if (existsSync(this.file)) saved = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      /* arquivo estragado: volta ao padrão */
    }
    this.cfg = cleanSite(saved, base);
  }

  /** grava a configuração e republica o site.json (escrita atômica: a CDN nunca pega meio arquivo) */
  save(next: Editable, superchat: boolean) {
    this.cfg = next;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(next, null, 2));
    this.publish(superchat);
  }

  publish(superchat: boolean) {
    const pub: SiteConfig = { ...this.cfg, superchat };
    mkdirSync(path.dirname(this.out), { recursive: true });
    writeFileSync(`${this.out}.tmp`, JSON.stringify(pub));
    renameSync(`${this.out}.tmp`, this.out);
  }
}
