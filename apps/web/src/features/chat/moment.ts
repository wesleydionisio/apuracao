// Momentos dentro do chat: o título vem com emoji na frente; trocamos por ícone + rótulo.
import type { CandidateDef } from '@apuracao/shared';
import { Bell, Calculator, CircleCheck, Flag, Repeat2, Zap, type LucideIcon } from 'lucide-react';

const ICONS: [RegExp, LucideIcon, string][] = [
  [/^🔔/u, Bell, 'Marco'],
  [/^⚡/u, Zap, 'Virada'],
  [/^🧮/u, Calculator, 'Definido'],
  [/^✅/u, CircleCheck, 'Totalizado'],
  [/^🏁/u, Flag, 'Cidade apurada'],
  [/^🔄/u, Repeat2, 'Virou de lado'],
];

export function momentParts(title: string): { Icon: LucideIcon; kind: string; text: string } {
  for (const [re, Icon, kind] of ICONS) {
    if (re.test(title)) return { Icon, kind, text: title.replace(re, '').replace(/^️?\s*/, '').trim() };
  }
  return { Icon: Bell, kind: 'Apuração', text: title };
}

/** candidatos citados num texto, na ordem em que aparecem */
export function mentioned(cands: CandidateDef[] | null | undefined, text: string): CandidateDef[] {
  if (!cands) return [];
  return cands
    .map((c) => ({ c, i: text.indexOf(c.short) }))
    .filter((x) => x.i >= 0)
    .sort((x, y) => x.i - y.i)
    .map((x) => x.c);
}

/** quem o momento favorece (virada → quem passou à frente), para a cor de destaque */
export function favored(cands: CandidateDef[] | null | undefined, text: string): CandidateDef | null {
  const who = mentioned(cands, text);
  if (!who.length) return null;
  // "X passa à frente", "deu X, agora Y": o último citado é quem está na frente agora
  if (/passa à frente|agora/i.test(text)) return who[who.length - 1];
  return null;
}
