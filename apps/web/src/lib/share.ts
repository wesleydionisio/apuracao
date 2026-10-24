// Compartilhar: Web Share com PNG quando o aparelho suporta; senão link; senão copiar.
export interface ShareInput {
  title: string;
  text: string;
  url: string;
  image?: string;
  filename?: string;
}

const blobCache = new Map<string, Promise<Blob | null>>();

/** Comece a baixar o PNG no pointerdown para o share ainda estar dentro do gesto do usuário. Falha (503 com a
 * fila de cards cheia, rede) não fica guardada: o próximo toque tenta de novo. */
export function prefetchImage(src?: string) {
  if (!src || blobCache.has(src)) return;
  blobCache.set(
    src,
    fetch(src)
      .then((r) => (r.ok && r.headers.get('content-type')?.startsWith('image/') ? r.blob() : null))
      .catch(() => null)
      .then((b) => {
        if (!b) blobCache.delete(src);
        return b;
      }),
  );
}

/** o PNG já chegou (o share sai na hora, ainda dentro do gesto) */
const ready = new Set<string>();
export function imageReady(src: string) {
  return ready.has(src);
}

/** baixa o PNG (gerado só agora, no toque) e devolve se deu */
export async function loadImage(src: string): Promise<boolean> {
  prefetchImage(src);
  const ok = !!(await blobCache.get(src));
  if (ok) ready.add(src);
  return ok;
}

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function share(i: ShareInput): Promise<ShareResult> {
  const url = new URL(i.url, location.origin).toString();
  if (navigator.share) {
    try {
      if (i.image) {
        prefetchImage(i.image);
        const blob = await blobCache.get(i.image)!;
        if (blob) {
          const file = new File([blob], i.filename ?? 'apuracao.png', { type: blob.type || 'image/png' });
          if (navigator.canShare?.({ files: [file] })) {
            await navigator.share({ files: [file], title: i.title, text: `${i.text}\n${url}` });
            return 'shared';
          }
        }
      }
      await navigator.share({ title: i.title, text: i.text, url });
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
      // NotAllowedError (gesto expirou) etc.: cai para copiar
    }
  }
  try {
    await navigator.clipboard.writeText(`${i.text} ${url}`);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** salva o PNG; com o blob em mãos, sai dele (sem pedir o card de novo); senão, o link direto */
export async function downloadImage(src: string, filename = 'apuracao.png') {
  prefetchImage(src);
  const blob = await blobCache.get(src);
  const a = document.createElement('a');
  a.href = blob ? URL.createObjectURL(blob) : src;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
  if (blob) setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}
