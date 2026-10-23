// Moderação mínima: normalização, termos bloqueados, bloqueio de links, limite de tamanho.
import { MAX_BODY } from './protocol';

/** Lista base. Extensível em runtime via BLOCKED_TERMS (separado por vírgula) ou arquivo. */
export const BASE_BLOCKED = [
  'porra', 'caralho', 'buceta', 'puta', 'puto', 'putaria', 'viado', 'veado', 'bicha', 'traveco',
  'macaco', 'crioulo', 'arrombado', 'arrombada', 'fdp', 'filhodaputa', 'vagabunda', 'vadia',
  'piranha', 'cuzao', 'cu', 'pau no cu', 'retardado', 'mongoloide', 'estupro', 'estuprar',
  'nazista', 'hitler', 'matar', 'morte ao', 'morra', 'bala nele', 'fuzilar', 'enforcar',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's' };

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[013457@$]/g, (c) => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1') // "porrrrra" -> "pora"... mantém 1
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const LINK_RE =
  /(https?:\/\/|www\.|\b[a-z0-9-]+\s?\.\s?(com|br|net|org|io|me|ly|gg|xyz|info|site|online|app|link|tv|club|top)\b|wa\.me|t\.me|chat\.whatsapp)/i;

export function hasLink(s: string): boolean {
  return LINK_RE.test(s);
}

export class Moderator {
  private words = new Set<string>();
  private phrases: string[] = [];

  constructor(terms: string[] = BASE_BLOCKED) {
    this.add(terms);
  }

  add(terms: string[]) {
    for (const t of terms) {
      const n = normalize(t).replace(/(.)\1+/g, '$1');
      if (!n) continue;
      if (n.includes(' ')) this.phrases.push(n);
      else this.words.add(n);
    }
  }

  isBlocked(text: string): boolean {
    const n = normalize(text).replace(/(.)\1+/g, '$1');
    if (this.phrases.some((p) => n.includes(p))) return true;
    const tokens = n.split(' ');
    if (tokens.some((t) => this.words.has(t))) return true;
    // palavras coladas/espaçadas: "p u t a"
    const joined = tokens.join('');
    for (const w of this.words) if (w.length >= 5 && joined.includes(w)) return true;
    return false;
  }

  /** Retorna o corpo limpo ou um motivo de recusa. */
  check(body: unknown): { ok: true; body: string } | { ok: false; reason: 'invalid' | 'blocked' } {
    if (typeof body !== 'string') return { ok: false, reason: 'invalid' };
    const clean = body.replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '').replace(/\s+/g, ' ').trim();
    if (!clean || [...clean].length > MAX_BODY) return { ok: false, reason: 'invalid' };
    if (hasLink(clean) || this.isBlocked(clean)) return { ok: false, reason: 'blocked' };
    return { ok: true, body: clean };
  }
}

/** Apelido: 2–24 chars, letras/números/espaço, sem termos bloqueados. */
export function cleanNick(nick: unknown, mod: Moderator): string | null {
  if (typeof nick !== 'string') return null;
  const n = nick.replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim();
  if (n.length < 2 || n.length > 24) return null;
  if (hasLink(n) || mod.isBlocked(n)) return null;
  return n;
}
