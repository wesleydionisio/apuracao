// Compartilhar: Web Share com PNG quando o aparelho suporta; senão link; senão copiar.
export interface ShareInput {
  title: string;
  text: string;
  url: string;
  image?: string;
  filename?: string;
}

const blobCache = new Map<string, Promise<Blob | null>>();

/** Comece a baixar o PNG no pointerdown para o share ainda estar dentro do gesto do usuário. */
export function prefetchImage(src?: string) {
  if (!src || blobCache.has(src)) return;
  blobCache.set(
    src,
    fetch(src)
      .then((r) => (r.ok && r.headers.get('content-type')?.startsWith('image/') ? r.blob() : null))
      .catch(() => null),
  );
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

export function downloadImage(src: string, filename = 'apuracao.png') {
  const a = document.createElement('a');
  a.href = src;
  a.download = filename;
  a.rel = 'noopener';
  a.click();
}
