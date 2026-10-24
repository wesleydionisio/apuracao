// Faixa fina no topo do cabeçalho: o patrocinador (quando há) ou o convite "anuncie aqui" com link para o WhatsApp.
// Altura fixa: trocar o conteúdo nunca mexe no layout. Sem fundo próprio: herda o vidro fosco do cabeçalho.
import { waLink } from '@apuracao/shared';
import { ArrowUpRight, Megaphone } from 'lucide-react';
import { useSite } from '@/lib/site';

export const STRIP_H = 44;

export function SponsorStrip() {
  const { sponsor, ad } = useSite((s) => s.site);
  const paid = sponsor.on && !!(sponsor.name || sponsor.text) && !!sponsor.url;
  if (!paid && !ad.whatsapp) return null;
  return (
    <div className="border-b">
      <div className="mx-auto flex max-w-3xl items-center px-4 lg:max-w-6xl" style={{ height: STRIP_H }}>
        {paid ? (
          <a
            href={sponsor.url}
            target="_blank"
            rel="sponsored noopener"
            className="group flex min-w-0 flex-1 items-center justify-center gap-2 text-[12px] text-muted-foreground"
          >
            <span className="shrink-0 rounded-[4px] border px-1 text-[9.5px] font-semibold tracking-wide uppercase">Patrocínio</span>
            {sponsor.image && <img src={sponsor.image} alt="" className="h-[18px] w-auto shrink-0 rounded-sm object-contain" />}
            <span className="min-w-0 truncate">
              {sponsor.name && <span className="font-semibold text-foreground">{sponsor.name}</span>}
              {sponsor.name && sponsor.text && ' · '}
              {sponsor.text}
            </span>
            <ArrowUpRight className="size-3.5 shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden />
          </a>
        ) : (
          <a
            href={waLink(ad.whatsapp)}
            target="_blank"
            rel="noopener"
            className="group flex min-w-0 flex-1 items-center justify-center gap-2 text-[12px] text-muted-foreground"
          >
            <Megaphone className="size-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 truncate">{ad.text}</span>
            <span className="shrink-0 font-semibold text-foreground underline-offset-2 group-hover:underline">Falar no WhatsApp</span>
          </a>
        )}
      </div>
    </div>
  );
}
