// Fundo do confronto: cada lado ganha um esmaecido suave na cor do seu candidato (A à esquerda, B à direita),
// sumindo antes do meio. Puramente decorativo: absoluto, sem pegar clique, sem mexer no layout.
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Coloque como primeiro filho de um pai `relative` (com `overflow-hidden` se o pai tiver cantos arredondados)
 * e deixe o conteúdo depois dele num elemento `relative`, para ficar por cima do brilho.
 * - `edge`: mais forte nas bordas (cartões e faixas de ponta a ponta).
 * - `soft`: manchas que somem antes das bordas (blocos soltos na folha, sem caixa em volta).
 * - `fadeBottom`: esmaece para baixo (placar com gráfico embaixo: o brilho fica só no confronto).
 */
export function VersusGlow({
  a = "var(--cand-a)",
  b = "var(--cand-b)",
  variant = "edge",
  fadeBottom = false,
  className,
}: {
  a?: string;
  b?: string;
  variant?: "edge" | "soft";
  fadeBottom?: boolean;
  className?: string;
}) {
  // --vg: intensidade na borda (--vg-mid no meio do caminho); bem mais discreto no tema claro
  const tint = (c: string, mid = false) =>
    `color-mix(in oklab, ${c} var(${mid ? "--vg-mid" : "--vg"}), transparent)`;
  const backgroundImage =
    variant === "edge"
      ? [
          `linear-gradient(to right, ${tint(a)}, ${tint(a, true)} 24%, transparent 48%)`,
          `linear-gradient(to left, ${tint(b)}, ${tint(b, true)} 24%, transparent 48%)`,
        ].join(",")
      : [
          `radial-gradient(closest-side, ${tint(a)}, ${tint(a, true)} 55%, transparent) 0 50% / 50% 100% no-repeat`,
          `radial-gradient(closest-side, ${tint(b)}, ${tint(b, true)} 55%, transparent) 100% 50% / 50% 100% no-repeat`,
        ].join(",");
  const mask = fadeBottom
    ? "linear-gradient(to bottom, #000 35%, transparent 90%)"
    : undefined;
  const style: CSSProperties =
    variant === "edge"
      ? { backgroundImage, maskImage: mask, WebkitMaskImage: mask }
      : { background: backgroundImage, maskImage: mask, WebkitMaskImage: mask };
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 [--vg-mid:3%] [--vg:7%] dark:[--vg-mid:6%] dark:[--vg:15%]",
        className,
      )}
      style={style}
    />
  );
}
