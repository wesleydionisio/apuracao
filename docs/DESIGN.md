# Design — Apuração 2º turno

Referências: **Polymarket (forte)** + clareza do **g1 apuração**. Mobile-first (90% celular, 360–414px).

## DNA visual

- **Tema**: grafite escuro (Polymarket) e claro limpo, ambos de primeira. Tokens em `src/index.css`
  (`bg-background`, `bg-card`, `text-muted-foreground`, `border-border`, `bg-muted`, `text-live`, `text-warning`).
  Classe `.dark` no `<html>`; escolha salva em `localStorage.theme`.
- **Cor**: sóbria. As únicas cores saturadas são as dos candidatos — sempre de `candidate.color`
  ou dos tokens `text-cand-a` / `bg-cand-b` (por `key`, nunca por nome) — e o verde do "ao vivo".
  Lula = vermelho, Flavio Bolsonaro = azul (vem do Board). Nada de gradientes decorativos.
- **Tipografia**: Inter Variable. Um número protagonista por bloco (`display`, `font-semibold`,
  tracking negativo, tabular). Rótulos `text-xs text-muted-foreground`, sem caixa alta.
  Escala: 40–56px herói · 28–32 número de bloco · 15–16 corpo · 12–13 meta.
- **Fotos**: `CandidateAvatar` (`@/components/core/candidate`) sempre que um candidato aparece:
  linhas do placar, fim das linhas do gráfico, legendas, cards, mensagens de sistema do chat.
- **Superfícies**: listas densas com divisórias (`divide-y`) estilo Polymarket, não "sopa de cards".
  Raio 12px. Borda sutil; sombra quase nenhuma no escuro.
- **Ícones**: `lucide-react`. Emoji só onde é conteúdo (reações do chat), nunca como ícone de UI.
- **Movimento**: `@number-flow/react` para números ao vivo; transições curtas (150–250ms, ease-out),
  só `transform`/`opacity`; ponto "ao vivo" com `live-ping`. Respeitar `prefers-reduced-motion`.
- **Componentes**: shadcn (`@/components/ui/*`): Button, Badge, Tabs, ToggleGroup, Drawer (vaul) para
  painéis no celular, Sheet no desktop, Command para busca, Tooltip, Skeleton, Sonner, Table, Progress.
  Não adicionar dependências npm novas.

## Padrões

- **Herói do placar** (home): cabeçalho tipo mercado — "Presidente · 2º turno" + status; gráfico de
  linha da noite (% dos válidos × % de urnas apuradas) com as duas linhas, rótulo no fim de cada linha
  (avatar + nome + %), ponto ao vivo pulsando na ponta, grade 25/50/75 à direita, pílulas
  "Hoje" / "× 2022", scrub por toque mostrando os valores. Abaixo, linhas de candidato (g1 + Polymarket):
  avatar, nome, partido, votos; à direita % grande + variação recente (`Delta`), barra fina na cor.
- **"Vira ou não vira"**: medidor claro do quanto o candidato atrás precisa vs. o que tem.
- **Mapa**: mapa real do Brasil (d3-geo, SVG), coroplético divergente pela margem (vermelho ↔ azul,
  intensidade = margem), toque abre Drawer com a UF e o mapa municipal (Canvas).
- **Confiança**: `SourceStamp` com hora do TSE em toda tela; "estimativa" + % apurado em projeções;
  nunca "eleito" antes de `totalizado`; disclaimer no rodapé.

## Proibido (UI slop)

Gradientes roxos/azuis, glassmorphism gratuito, cards com ícone gigante + texto genérico, emojis em
títulos, sombras pesadas, cinco tamanhos de fonte por bloco, cores fora dos tokens, "lorem"/copy vaga,
skeletons eternos, layout que só funciona no desktop.
