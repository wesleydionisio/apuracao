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

## Arquitetura de telas (v3)

- **Ao vivo** (`/`): tela única no celular, sem rolagem da página — placar compacto e muito visível no
  topo, chat ocupando o resto (como uma live). Chips para mostrar/ocultar referências: **1º turno**,
  **2022** (2º turno passado) e **Gráfico**. Desktop: placar + gráfico à esquerda, chat fixo à direita.
- **Painel** (`/painel`): a análise completa (gráfico grande, vira ou não vira, onde falta, projeção,
  momentos, transferência, virou de lado).
- **Mapa**, **Cidade**, **Palpite**: como antes, mais ricos.
- Abas: Ao vivo · Painel · Mapa · Cidade · Palpite. `/chat` redireciona para `/`.

## Chat viral e limpo

- Estilo live (Twitch/YouTube), não "app de mensagens": uma linha por mensagem, apelido colorido pelo
  `hue`, selo do lado escolhido (13/22 na cor do candidato) ao lado do apelido, texto 14px.
- **Torcida**: botões "Manda um 13" / "Manda um 22" (`live.cheer`) com selos subindo na tela e um
  cabo-de-guerra discreto com os totais (`cheer:a` / `cheer:b` no agregado de reações), sempre
  rotulado "torcida do chat · não é pesquisa".
- **Emoji de partido**: tokens `:13:` `:22:` `:pt:` `:pl:` no texto viram selos na cor do candidato
  (número + sigla, sem logotipos oficiais). Seletor de emoji no composer com a linha "Torcida" + emojis.
- Escolha de lado: `live.side('a'|'b'|null)`, perguntada com elegância na primeira torcida/mensagem,
  com "prefiro não dizer".

## Riqueza sem slop

- Densidade de informação de mercado: cada linha carrega número + contexto (variação, referência,
  mini barra). Tabelas alinhadas à direita, tabulares, com divisórias finas.
- Hierarquia por contraste de peso/tamanho, não por caixas. Agrupe seções numa folha contínua com
  divisórias em vez de empilhar cards idênticos; use cards só quando separar faz sentido.
- Cabeçalhos de seção com ícone lucide pequeno + título curto + meta à direita (ex.: "atualizado há 12s").
- Micro-visualizações em todo lugar que couber: barras bicolores, sparklines, marcadores de referência.
- Feedback de atualização: número animado, barra com transição, linha que pisca sutilmente quando muda.
- Estados vazios explicam e oferecem ação; nunca um card em branco.
