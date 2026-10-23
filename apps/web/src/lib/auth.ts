// Login do chat: Google Identity Services (botão oficial → ID token) e cadastro (nome, celular, usuário).
// A sessão é um cookie httpOnly; depois de entrar/sair o WS reconecta para levar o cookie novo.
import { getJSON, HttpError } from './api';

export interface AuthUser {
  username: string;
  hue: number;
}

export interface AuthInfo {
  user: AuthUser | null;
  /** Client ID do Google; null = login com Google desligado neste ambiente */
  google: string | null;
  /** login de teste (só em dev, sem Client ID) */
  dev: boolean;
}

export interface SignupStart {
  token: string;
  name: string;
  email: string;
}

export type SignInResult = { user: AuthUser } | { signup: SignupStart };

const post = <T>(path: string, body: unknown) =>
  getJSON<T>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const auth = {
  info: () => getJSON<AuthInfo>('/api/auth/me', { cache: 'no-store' }),
  google: (credential: string) => post<SignInResult>('/api/auth/google', { credential }),
  dev: (email: string) => post<SignInResult>('/api/auth/dev', { email }),
  signup: (b: { token: string; name: string; phone: string; username: string }) => post<{ user: AuthUser }>('/api/auth/signup', b),
  usernameOk: (u: string) => getJSON<{ ok: boolean; valid: boolean }>(`/api/auth/username?u=${encodeURIComponent(u)}`),
  logout: () => post<{ ok: true }>('/api/auth/logout', {}),
};

export const SIGNUP_ERR: Record<string, string> = {
  name: 'Escreva seu nome (2 a 80 letras).',
  phone: 'Celular com DDD, ex.: (11) 91234-5678.',
  username: 'Usuário de 2 a 24 caracteres: letras, números, espaço, ponto, - ou _. Sem ofensas.',
  taken: 'Esse usuário já existe. Tente outro.',
  expired: 'O login expirou. Entre com o Google de novo.',
  rate: 'Muitas tentativas. Espere um pouco.',
};
export const errCode = (e: unknown) => (e instanceof HttpError ? (e.code ?? String(e.status)) : 'net');

/** (11) 91234-5678 enquanto digita */
export function maskPhone(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d.length ? `(${d}` : '';
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

// ---------------------------------------------------------------- Google Identity Services

interface Gis {
  initialize(o: { client_id: string; callback: (r: { credential: string }) => void; ux_mode?: 'popup'; use_fedcm_for_button?: boolean }): void;
  renderButton(el: HTMLElement, o: Record<string, unknown>): void;
}
declare global {
  interface Window {
    google?: { accounts: { id: Gis } };
  }
}

let gisP: Promise<Gis> | null = null;
export function loadGis(): Promise<Gis> {
  return (gisP ??= new Promise<Gis>((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve(window.google.accounts.id);
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => (window.google?.accounts?.id ? resolve(window.google.accounts.id) : reject(new Error('gis')));
    s.onerror = () => {
      gisP = null;
      reject(new Error('gis'));
    };
    document.head.appendChild(s);
  }));
}
