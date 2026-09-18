---
name: game-visual-standard
description: Mantém o padrão visual do jogo Aetheria Online em qualquer alteração de telas, HUD, modais, overlays ou estilos em apps/web. Use quando a tarefa envolver UI Angular, Phaser HUD ou SCSS do cliente.
---

# Padrão Visual Do Game

Use estas regras em toda alteração visual dentro de `apps/web`.

## Direção

O jogo usa a linguagem visual **fantasia arcana funcional**: painel de comando de uma guilda, com superfícies de metal escuro, contraste alto, detalhes âmbar e estados semânticos claros.

Não introduza uma nova linguagem visual para uma tela ou modal isolado. Login, personagens, HUD, Hunts, inventário, Helper, aparência, tooltips e dialogs devem parecer partes do mesmo produto.

## Tokens Obrigatórios

Use os tokens definidos em `apps/web/src/styles.scss` em vez de duplicar hexadecimais:

- Fundo: `--ui-bg`
- Superfícies: `--ui-surface`, `--ui-surface-raised`, `--ui-surface-soft`
- Bordas: `--ui-border`, `--ui-border-strong`
- Texto: `--ui-text`, `--ui-text-muted`, `--ui-text-subtle`
- Ações e destaque: `--ui-gold`, `--ui-gold-bright`
- Semânticos: `--ui-blue`, `--ui-violet`, `--ui-green`, `--ui-red`
- Raios: `--ui-radius-sm`, `--ui-radius-md`, `--ui-radius-lg`
- Elevação: `--ui-shadow-panel`, `--ui-shadow-modal`

Só crie um token novo quando o valor representar uma decisão visual reutilizável. Não adicione cores locais equivalentes a tokens existentes.

## Componentes

Preserve e reutilize os padrões globais:

- Botões devem ter estados normal, hover, active, disabled e `:focus-visible`.
- Ações principais usam âmbar; ações destrutivas usam vermelho; informações usam azul; estados positivos usam verde.
- Inputs e selects devem manter altura, borda, raio e foco consistentes.
- Painéis usam borda discreta, superfície escura e sombra moderada.
- Modais usam backdrop escuro com blur sutil, header, conteúdo e footer consistentes.
- Tooltips e menus contextuais devem usar a elevação de modal e não criar sombras próprias arbitrárias.
- Barras de vida, mana, XP e stamina mantêm respectivamente vermelho, azul, âmbar e verde.

## HUD E JOGO

- Não altere a autoridade do servidor, GameState ou protocolo para resolver uma necessidade visual.
- Phaser deve continuar responsável pela renderização do mundo; Angular deve cuidar do HUD e overlays.
- Mantenha o mapa como foco principal. Não cubra a área jogável sem necessidade.
- Sidebars podem virar drawers em telas menores, mas não podem impedir o acesso ao mapa.
- Hotbar deve permanecer utilizável por mouse, teclado e toque.
- Estados críticos, como vida baixa, derrota, loot cheio e boss, devem usar cor e texto, não apenas cor.

## Layout E Responsividade

Respeite estes pontos de adaptação:

- `1200px`: compactar sidebars e topbar.
- `900px`: transformar sidebars em drawers.
- `720px`: reorganizar header, hunt e hotbar.
- `560px`: empilhar conteúdo de modais.
- `400px`: reduzir paddings e grids para uma coluna.

Todo modal novo precisa funcionar em desktop, tablet e viewport estreita, com scroll interno quando necessário.

## Acessibilidade

- Todo controle interativo precisa de foco visível.
- Não dependa somente de hover.
- Use `aria-label` para ícones e controles sem texto.
- Respeite `prefers-reduced-motion`.
- Mantenha contraste suficiente entre texto, fundo, borda e estado ativo.
- Não use texto em caixa alta para grandes blocos de conteúdo; reserve-o para labels curtos.

## Organização De Estilos

- Tokens e padrões globais ficam em `apps/web/src/styles.scss`.
- Estilos específicos de uma tela ficam junto do componente.
- Não aumente desnecessariamente `game.scss`; mova padrões compartilhados para o stylesheet global.
- Não duplique regras de modal, botão, input ou painel entre componentes.
- Mantenha a lógica Angular/Phaser separada da decisão visual sempre que possível.
- Evite `!important`, exceto para corrigir uma colisão documentada entre estilos globais e encapsulados.

## Checklist Antes De Finalizar

- A alteração usa tokens existentes?
- O componente mantém a linguagem visual do restante do jogo?
- Hover, active, disabled e foco foram considerados?
- O layout funciona nos breakpoints do projeto?
- A navegação por teclado e toque continua possível?
- Modais e drawers não escondem ações essenciais?
- `npm run build:web` foi executado?
- Novas cores ou padrões foram realmente generalizados, quando necessário?
