# PROMPT DE IMPLEMENTAÇÃO — CENTRAL DE COMANDO: EDITOR DE SPRITES, OUTFITS E MOVIMENTAÇÃO DE CRIATURAS DO Aetheria ADLE

Você está trabalhando no desenvolvimento do **Aetheria Adle**, um RPG online com combate automático, criaturas animadas em pixel art, backend autoritativo, PostgreSQL e uma Central de Comando administrativa.

Sua tarefa é desenvolver dentro da **Central de Comando** uma ferramenta completa para cadastro, importação, recorte, configuração, preview e programação visual das animações de todas as criaturas do jogo.

A ferramenta deve funcionar como um **Creature / Outfit Builder** integrado ao próprio Aetheria Adle.

O administrador deverá conseguir importar uma spritesheet como a imagem de exemplo, dividir automaticamente a imagem em sprites de **32×32 pixels**, mapear cada frame para uma direção e estado de animação, reproduzir a animação em tempo real, alterar a ordem dos frames, configurar duração e salvar tudo no servidor.

A ferramenta deve substituir a necessidade de programar manualmente cada criatura em código.

---

# 1. OBJETIVO

Quero transformar uma spritesheet como:

```text
┌────┬────┬────┬────┐
│ 01 │ 02 │ 03 │ 04 │
├────┼────┼────┼────┤
│ 05 │ 06 │ 07 │ 08 │
├────┼────┼────┼────┤
│ .. │ .. │ .. │ .. │
└────┴────┴────┴────┘
```

em uma definição de animação utilizável diretamente pelo Game Engine.

Fluxo:

```text
UPLOAD SPRITESHEET
↓
DETECTAR DIMENSÕES
↓
RECORTAR EM 32×32
↓
GERAR SPRITES
↓
ASSOCIAR SPRITES A DIREÇÕES
↓
ASSOCIAR SPRITES A ANIMAÇÕES
↓
CONFIGURAR FPS / DURAÇÃO
↓
PREVIEW
↓
SALVAR
↓
GAME ENGINE USA AUTOMATICAMENTE
```

---

# 2. CENTRAL DE COMANDO

Adicionar módulo:

```text
Central de Comando
→ Criaturas
→ Editor de Outfit / Sprite
```

Rotas sugeridas:

```text
/admin/creatures
/admin/creatures/:creatureId
/admin/creatures/:creatureId/animation
```

---

# 3. CADA CRIATURA PRECISA DE UM ID

Criar um identificador numérico único:

```ts
type CreatureId = number;
```

Exemplo:

```text
CreatureID 1000
Dwarf

CreatureID 1001
Rat

CreatureID 1002
Dragon
```

O ID deve ser permanente.

Nunca utilizar nome da criatura como chave principal.

---

# 4. CREATURE DEFINITION

Criar estrutura semelhante a:

```ts
interface CreatureDefinition {
  creatureId: number;

  slug: string;

  name: string;

  description?: string;

  enabled: boolean;

  spriteConfig?: CreatureSpriteConfig;

  createdAt: Date;

  updatedAt: Date;
}
```

---

# 5. SPRITE SIZE

O padrão oficial inicialmente será:

```text
32×32 pixels
```

Config:

```ts
export const SPRITE_CONFIG = {
  defaultWidth: 32,
  defaultHeight: 32,
};
```

Não espalhar `32` pelo código.

---

# 6. SUPORTE FUTURO A CRIATURAS GRANDES

Apesar do padrão ser 32×32, preparar arquitetura para:

```text
32×32
64×32
32×64
64×64
96×96
etc.
```

Por isso a configuração deve possuir:

```ts
interface SpriteDimensions {
  tileWidth: number;
  tileHeight: number;

  widthInTiles: number;
  heightInTiles: number;
}
```

Para o caso atual:

```text
tileWidth = 32
tileHeight = 32

widthInTiles = 1
heightInTiles = 1
```

---

# 7. IMPORTAÇÃO DA SPRITESHEET

Criar área:

```text
IMPORTAR SPRITESHEET
```

Aceitar:

```text
PNG
WEBP
```

GIF pode ser suportado futuramente, mas a spritesheet principal deve preferir imagens estáticas contendo os frames.

---

# 8. UPLOAD

Interface:

```text
Arraste a spritesheet aqui

ou

[Selecionar arquivo]
```

Após selecionar:

mostrar imediatamente:

```text
Imagem
Largura
Altura
Quantidade estimada de sprites
```

---

# 9. DETECÇÃO DA GRADE

Se imagem possui:

```text
128×256
```

e sprite:

```text
32×32
```

então:

```text
columns = 4
rows = 8
frames = 32
```

Usar:

```ts
columns =
  imageWidth / spriteWidth;

rows =
  imageHeight / spriteHeight;
```

Validar divisão exata.

---

# 10. NÃO ASSUMIR SEMPRE 4 COLUNAS

A spritesheet pode possuir configurações diferentes.

Editor deve permitir alterar:

```text
Sprite Width
Sprite Height
Columns
Rows
```

e recalcular preview.

---

# 11. SPRITE CUTTER

Criar:

```text
SpriteSheetCutter
```

Responsável por transformar a spritesheet em frames virtuais.

Não precisa necessariamente gerar 32 arquivos físicos separados.

Pode armazenar:

```text
sourceX
sourceY
width
height
```

---

# 12. FRAME DEFINITION

Criar:

```ts
interface SpriteFrame {
  index: number;

  x: number;
  y: number;

  width: number;
  height: number;
}
```

Exemplo:

```ts
{
  index: 6,
  x: 64,
  y: 32,
  width: 32,
  height: 32
}
```

---

# 13. SPRITE INDEX

Indexação visual deve começar preferencialmente em:

```text
0
```

internamente.

Pode mostrar:

```text
Frame 1
Frame 2
...
```

na interface para facilitar uso humano.

---

# 14. SPRITE GRID

Na direita do editor, mostrar todos os frames.

Exemplo:

```text
SPRITES

[0]
[1]
[2]
[3]
[4]
...
```

Cada entrada mostra miniatura 32×32.

---

# 15. CLIQUE NO FRAME

Ao clicar:

selecionar o frame.

Mostrar:

```text
Frame
Index
X
Y
Animation usage
```

---

# 16. EDITOR PRINCIPAL

Layout aproximado:

```text
┌──────────────────────────────────────────────────────────────┐
│ CREATURE ANIMATION EDITOR — DWARF                           │
├───────────────┬───────────────────────────────┬──────────────┤
│ ANIMAÇÕES     │                               │ SPRITES      │
│               │        PREVIEW                │              │
│ Idle          │                               │ [00]         │
│ Walk          │          DWARF                │ [01]         │
│ Attack        │                               │ [02]         │
│ Hit           │                               │ [03]         │
│ Death         │                               │ ...          │
│               │                               │              │
├───────────────┴───────────────────────────────┴──────────────┤
│ FRAMES / DIREÇÃO / FPS / LOOP / CONFIG                      │
└──────────────────────────────────────────────────────────────┘
```

---

# 17. ANIMATION TYPES

Preparar:

```ts
type CreatureAnimationType =
  | "idle"
  | "walk"
  | "attack"
  | "cast"
  | "hit"
  | "death"
  | "spawn";
```

Não exigir que todas existam.

Uma criatura pode possuir inicialmente apenas:

```text
idle
walk
```

---

# 18. DIREÇÕES

Suportar:

```ts
type Direction =
  | "north"
  | "east"
  | "south"
  | "west";
```

---

# 19. ORDEM VISUAL

Na interface:

```text
Norte
Leste
Sul
Oeste
```

ou orientação já utilizada pelo Game Engine.

---

# 20. IMPORTANTE — NÃO HARDCODE A ORDEM DA SPRITESHEET

Algumas sheets podem estar:

```text
south
east
north
west
```

Outras:

```text
north
east
south
west
```

Logo o editor deve permitir mapear cada direção.

---

# 21. FRAME SEQUENCE

Cada animação/direção possui:

```ts
interface AnimationSequence {
  animation: CreatureAnimationType;

  direction: Direction;

  frames: number[];

  frameDurationMs: number;

  loop: boolean;
}
```

Exemplo:

```ts
{
  animation: "walk",
  direction: "south",

  frames: [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7
  ],

  frameDurationMs: 120,

  loop: true
}
```

---

# 22. MOVIMENTAÇÃO COMO NO EXEMPLO

A spritesheet enviada possui várias poses sequenciais da mesma criatura.

O editor deve permitir organizar visualmente algo como:

```text
WALK SOUTH

[frame 0]
→
[frame 1]
→
[frame 2]
→
[frame 3]
→
...
```

---

# 23. DRAG & DROP DOS FRAMES

O administrador deve conseguir arrastar sprites da lista:

```text
SPRITES
```

para:

```text
WALK SOUTH
```

---

# 24. REORDENAR

Também deve ser possível:

```text
drag frame
→ change order
```

Exemplo:

```text
Antes:
0 1 2 3

Depois:
0 2 1 3
```

---

# 25. REMOVE FRAME

Cada frame da timeline deve possuir ação:

```text
Remover
```

ou click direito/menu.

---

# 26. DUPLICATE FRAME

Permitir o mesmo frame mais de uma vez.

Exemplo:

```text
0
1
2
1
0
```

Pode ser útil para animações de ida/volta.

---

# 27. FRAME DURATION

Configurar:

```text
Frame Duration
```

Exemplo:

```text
100ms
120ms
150ms
200ms
```

---

# 28. FPS

Também mostrar equivalente:

```text
FPS
```

Exemplo:

```text
125ms/frame
=
8 FPS
```

Alterar um recalcula o outro.

---

# 29. DURAÇÃO POR FRAME OPCIONAL

Preparar suporte futuro:

```ts
interface AnimationFrameReference {
  frame: number;

  durationMs?: number;
}
```

Assim um frame específico pode durar mais.

---

# 30. LOOP

Walking:

```text
loop = true
```

Idle:

normalmente:

```text
loop = true
```

Attack:

```text
loop = false
```

Death:

```text
loop = false
```

---

# 31. PLAYBACK MODE

Adicionar:

```text
Normal
Ping Pong
```

Exemplo Ping Pong:

```text
0
1
2
3
2
1
```

sem precisar duplicar manualmente.

---

# 32. PREVIEW CENTRAL

Criar área grande de preview.

Mostrar criatura ampliada utilizando:

```text
nearest-neighbor
```

Nunca blur.

CSS:

```css
image-rendering: pixelated;
```

---

# 33. ZOOM

Adicionar:

```text
1×
2×
4×
8×
```

Exemplo:

32×32 em zoom 8:

```text
256×256
```

---

# 34. GRID PREVIEW

Opção:

```text
Mostrar grade
```

---

# 35. EXACT SIZE

Opção:

```text
Mostrar tamanho real
```

Assim admin consegue ver 32×32 real.

---

# 36. CONTROLES DE PREVIEW

Adicionar:

```text
Play
Pause
Stop
Frame anterior
Próximo frame
```

---

# 37. SPEED

Adicionar:

```text
0.5×
1×
1.5×
2×
```

apenas para preview.

Não alterar config real automaticamente.

---

# 38. DIRECTION CONTROLS

Botões:

```text
↑
→
↓
←
```

Mudam direção do preview.

---

# 39. KEYBOARD

Opcionalmente:

```text
ArrowUp
ArrowRight
ArrowDown
ArrowLeft
```

mudam direção.

---

# 40. SIMULAÇÃO DE WALKING

Adicionar opção:

```text
Simular movimento
```

Ao ativar:

a criatura realmente se desloca dentro da área de preview enquanto a animação roda.

---

# 41. MOVEMENT PREVIEW

Exemplo:

```text
start x=50
↓
walk east animation
↓
sprite moves horizontally
```

---

# 42. MOVEMENT SPEED

Adicionar:

```text
Preview Movement Speed
```

apenas para inspeção.

---

# 43. MOVEMENT SPEED DO JOGO

Não confundir:

```text
animation FPS
```

com:

```text
creature movement speed
```

São propriedades diferentes.

---

# 44. GAME CREATURE SPEED

Creature Definition pode possuir:

```ts
movementSpeed: number;
```

Mas não precisa ser alterada pelo Animation Editor se já existir outro editor de stats.

---

# 45. WALK CYCLE

O Game Renderer deve sincronizar:

```text
movement
+
walk animation
```

Enquanto criatura estiver se movendo:

```text
animation = walk
```

Quando parar:

```text
animation = idle
```

---

# 46. DIREÇÃO AUTOMÁTICA

Game Engine escolhe direção de acordo com vetor de movimento.

Exemplo:

```text
dx > 0
→ east

dx < 0
→ west

dy > 0
→ south

dy < 0
→ north
```

Adaptar às coordenadas reais do jogo.

---

# 47. DIAGONAL

Se houver movimentação diagonal, inicialmente usar direção predominante.

Exemplo:

```text
abs(dx) > abs(dy)
→ east/west

else
→ north/south
```

Pode adicionar 8 direções futuramente.

---

# 48. FUTURO 8 DIRECTIONS

Preparar arquitetura para:

```text
north
north_east
east
south_east
south
south_west
west
north_west
```

Mas não exigir agora.

---

# 49. IDLE FALLBACK

Se não houver animação `idle`:

usar primeiro frame da animação `walk` da direção atual.

---

# 50. ATTACK FALLBACK

Se não houver `attack`:

não quebrar.

Pode manter frame idle/walk durante ataque.

---

# 51. HIT FALLBACK

Mesma regra.

---

# 52. DEATH FALLBACK

Pode usar último frame ou desaparecer conforme renderer existente.

---

# 53. SPRITESHEET STORAGE

Assim como os assets dos itens, armazenar spritesheets no PostgreSQL.

Criar:

```text
creature_sprite_assets
```

---

# 54. TABELA

Exemplo:

```text
id UUID

creature_id INTEGER UNIQUE

file_name VARCHAR

mime_type VARCHAR

file_size INTEGER

image_width INTEGER
image_height INTEGER

data BYTEA

checksum VARCHAR

uploaded_by UUID

created_at
updated_at
```

---

# 55. NOME AUTOMÁTICO

Arquivo enviado:

```text
meu_dwarf_final.png
```

CreatureID:

```text
1035
```

Persistir logicamente como:

```text
1035.png
```

---

# 56. NÃO CONFIAR NO NOME ORIGINAL

Nome vem do CreatureID.

---

# 57. CONFIG DE ANIMAÇÃO

Persistir separadamente do blob.

Criar:

```text
creature_animation_configs
```

---

# 58. EXEMPLO DE CONFIG

Pode usar JSONB validado:

```json
{
  "spriteWidth": 32,
  "spriteHeight": 32,

  "sheetColumns": 4,
  "sheetRows": 8,

  "animations": {
    "walk": {
      "south": {
        "frames": [0,1,2,3],
        "frameDurationMs": 120,
        "loop": true
      },

      "east": {
        "frames": [4,5,6,7],
        "frameDurationMs": 120,
        "loop": true
      },

      "north": {
        "frames": [8,9,10,11],
        "frameDurationMs": 120,
        "loop": true
      },

      "west": {
        "frames": [12,13,14,15],
        "frameDurationMs": 120,
        "loop": true
      }
    }
  }
}
```

---

# 59. VALIDAR JSON

Nunca aceitar JSON arbitrário sem validação.

Usar Zod.

---

# 60. VERSIONAMENTO

Criar:

```text
version
```

da configuração.

Cada Save:

```text
version += 1
```

---

# 61. PREVIEW NÃO SALVA AUTOMATICAMENTE

Admin pode experimentar.

Só salvar quando clicar:

```text
Salvar animação
```

---

# 62. UNSAVED STATE

Mostrar:

```text
Alterações não salvas
```

---

# 63. RESET

Adicionar:

```text
Descartar alterações
```

---

# 64. AUTO-MAP

Criar ferramenta:

```text
Auto Map
```

para facilitar sheets organizadas.

Admin informa:

```text
Frames por direção: 8
Direções: 4
```

Sistema monta automaticamente.

---

# 65. AUTO-MAP MODES

Exemplo:

```text
Direction by rows
```

ou:

```text
Direction by columns
```

---

# 66. EXEMPLO POR LINHAS

```text
Row 1 → South
Row 2 → East
Row 3 → North
Row 4 → West
```

---

# 67. EXEMPLO POR COLUNAS

```text
Column 1 → South
Column 2 → East
...
```

---

# 68. NÃO ASSUMIR

Admin vê preview antes de confirmar Auto Map.

---

# 69. SPRITE SHEET INSPECTOR

Mostrar:

```text
Image:
128 × 256

Sprite:
32 × 32

Columns:
4

Rows:
8

Total frames:
32
```

---

# 70. FRAME NUMBER OVERLAY

Opção:

```text
Mostrar IDs
```

Sobre cada sprite:

```text
0
1
2
3
...
```

---

# 71. FRAME SELECTION

Permitir multi-select.

Exemplo:

Shift click:

```text
0–7
```

Depois:

```text
Adicionar a Walk South
```

---

# 72. DRAG MULTIPLE

Opcional.

Se implementação ficar complexa, multi-select + botão é suficiente.

---

# 73. ANIMATION TIMELINE

Parte inferior:

```text
WALK — SOUTH

[0][1][2][3][4][5][6][7]

Frame: 4 / 8
Duration: 120ms
Loop: ON
```

---

# 74. PLAYHEAD

Mostrar marcador do frame atualmente reproduzido.

---

# 75. CLICK TIMELINE FRAME

Seleciona e mostra imediatamente no preview.

---

# 76. ATTACK ANIMATION

Configurar da mesma forma:

```text
ATTACK — SOUTH
```

---

# 77. ATTACK EVENT FRAME

Preparar possibilidade futura de marcar:

```text
Hit Frame
```

Exemplo:

```text
frame 3
→ damage visual happens
```

---

# 78. ACTION MARKERS

Adicionar arquitetura para markers:

```ts
interface AnimationMarker {
  frameIndex: number;

  event:
    | "hit"
    | "projectile"
    | "sound"
    | "effect";
}
```

---

# 79. NÃO PRECISA SER AUTORITATIVO

Importante:

Combat Engine continua decidindo quando o dano ocorre.

O marker serve para sincronização visual.

---

# 80. SERVER DAMAGE NÃO ESPERA ANIMAÇÃO

Não transformar animation frame em regra de combate.

Backend:

```text
damage is authoritative
```

Frontend:

```text
animation visualizes it
```

---

# 81. CAST MARKER

Pode marcar frame em que efeito visual sai da criatura.

---

# 82. DEATH ANIMATION

Death pode terminar e permanecer no último frame por:

```text
X ms
```

antes de sumir.

Adicionar:

```ts
holdLastFrameMs?: number;
```

---

# 83. SPAWN ANIMATION

Opcional.

---

# 84. OUTFIT VARIANTS

Preparar arquitetura para uma criatura ter:

```text
base outfit
variant
boss version
seasonal version
```

Não precisa implementar agora.

---

# 85. FRAME GROUPS

Preparar conceito semelhante a grupos de animação:

```text
Idle
Walking
Attack
etc.
```

Cada grupo possui sequences.

---

# 86. LAYERS

No futuro algumas criaturas podem ter múltiplas camadas.

Preparar:

```text
layers
```

mas MVP pode usar:

```text
1
```

---

# 87. PATTERN X / Y / Z

Não precisa copiar exatamente formatos de ferramentas antigas.

Criar modelo mais legível:

```text
directions
animations
variants
layers
```

---

# 88. PREVIEW BACKGROUND

Permitir:

```text
Dark
Light
Grass
Stone
Transparent Grid
```

para verificar contraste.

Usar backgrounds próprios.

---

# 89. HITBOX PREVIEW

Adicionar opção:

```text
Mostrar hitbox
```

Para sprite padrão:

```text
32×32 tile
```

---

# 90. CREATURE ANCHOR

Muito importante.

Cada sprite precisa de um ponto de ancoragem.

Default:

```text
bottom center
```

Criar:

```ts
interface SpriteAnchor {
  x: number;
  y: number;
}
```

---

# 91. DEFAULT ANCHOR

Para 32×32:

```text
x = 16
y = 32
```

ou padrão correspondente ao renderer.

---

# 92. EDITOR DE ANCHOR

Permitir arrastar uma pequena cruz no preview.

Isso será importante para criaturas maiores.

---

# 93. MESMO ANCHOR EM TODAS AS DIREÇÕES

Default sim.

Futuramente permitir por animation frame se necessário.

---

# 94. FRAME OFFSETS

Preparar:

```ts
offsetX
offsetY
```

por frame.

Útil quando sprites da sheet não estão perfeitamente alinhados.

---

# 95. NÃO MODIFICAR IMAGEM ORIGINAL

Offsets são metadata.

---

# 96. GAME RENDERER

Criar componente/classe:

```text
CreatureAnimator
```

---

# 97. CREATURE ANIMATOR

Responsável por:

```text
current animation
current direction
current frame
elapsed
loop
```

---

# 98. RUNTIME VISUAL

Exemplo:

```ts
interface CreatureAnimationRuntime {
  animation: CreatureAnimationType;

  direction: Direction;

  frameIndex: number;

  animationStartedAt: number;
}
```

---

# 99. NÃO CRIAR setInterval POR CRIATURA

Game renderer já possui loop visual.

Animações avançam usando:

```text
elapsed time
```

---

# 100. CLIENT 60 FPS

Dentro do render loop:

```ts
elapsed =
  now - animationStartedAt;
```

Calcular frame a partir disso.

---

# 101. NÃO INCREMENTAR FRAME COMO FONTE

Evitar depender de:

```ts
frame++;
```

por timer.

Melhor:

```ts
frame =
  Math.floor(
    elapsed / frameDurationMs
  ) % frameCount;
```

para animação loop.

---

# 102. EVITA DRIFT

Se browser perder frames:

animação continua sincronizada.

---

# 103. WALK START

Quando entidade começa a se mover:

```text
setAnimation("walk")
```

---

# 104. WALK STOP

Quando velocidade chega a zero:

```text
setAnimation("idle")
```

---

# 105. ATTACK

Quando backend emite:

```text
BASIC_ATTACK
```

ou evento ofensivo correspondente:

```text
play attack animation
```

se configurada.

Ao terminar:

```text
return to walk/idle
```

---

# 106. SPELL CAST

Pode usar:

```text
cast
```

se disponível.

Caso contrário:

```text
attack
```

ou idle.

---

# 107. HIT

Ao receber dano:

pode executar `hit`.

Não deixar Hit interromper Death.

---

# 108. PRIORIDADE DE ANIMAÇÃO

Criar prioridades.

Exemplo:

```text
death
>
attack/cast
>
hit
>
walk
>
idle
```

A regra final pode ser refinada.

---

# 109. DEATH NÃO É INTERROMPIDA

Uma vez iniciada:

```text
death
```

não voltar para walk.

---

# 110. GAME CONTENT CACHE

Assim como itens, configurações de criatura devem ficar cacheadas.

Criar:

```text
CreatureRegistry
```

---

# 111. LOAD

Ao iniciar servidor/renderer:

carregar metadata.

A imagem usa endpoint/cache separado.

---

# 112. ASSET ENDPOINT

Criar:

```text
GET /assets/creatures/:creatureId
```

Exemplo:

```text
/assets/creatures/1035
```

---

# 113. HTTP CACHE

Usar:

```text
ETag
Cache-Control
```

---

# 114. NÃO BAIXAR SPRITESHEET A CADA MONSTRO

Se existem 20 Dwarfs:

baixar asset do Dwarf:

```text
1 vez
```

e reutilizar textura.

---

# 115. TEXTURE CACHE

Frontend:

```text
Map<CreatureId, Texture>
```

ou cache do engine utilizado.

---

# 116. ADMIN UPLOAD

Criar:

```text
POST /admin/creatures/:creatureId/spritesheet
```

---

# 117. GET CONFIG

```text
GET /admin/creatures/:creatureId/animation
```

---

# 118. UPDATE CONFIG

```text
PUT /admin/creatures/:creatureId/animation
```

---

# 119. PREVIEW LOCAL

Admin preview não precisa salvar antes de testar.

Usar arquivo local via:

```text
ObjectURL
```

quando possível.

---

# 120. SAVE

Ao salvar:

```text
validate
↓
transaction
↓
store config
↓
increment version
↓
invalidate CreatureRegistry
```

---

# 121. LIVE GAME UPDATE

Após Save:

novas criaturas podem usar configuração nova imediatamente.

Criaturas já visíveis podem atualizar na próxima unidade segura.

---

# 122. NÃO QUEBRAR CRIATURA EM COMBATE

Se animação muda enquanto criatura está atacando:

preferir aplicar:

```text
next animation transition
```

ou recarregar texture de forma segura.

---

# 123. AUDIT LOG

Central de Comando deve registrar:

```text
CREATURE_SPRITESHEET_UPLOADED
CREATURE_ANIMATION_UPDATED
```

---

# 124. HISTORY

Guardar:

```text
before config
after config
```

no audit.

Não guardar blob duplicado no audit.

---

# 125. PRESET DE IMPORTAÇÃO

Criar presets:

```text
4 directions
8 frames per direction
32×32
```

etc.

Isso acelera cadastro.

---

# 126. COPY CONFIG

Permitir:

```text
Copiar configuração de outra criatura
```

Muito útil para spritesheets com o mesmo layout.

Exemplo:

```text
Dwarf
Dwarf Guard
Dwarf Soldier
```

podem compartilhar estrutura.

---

# 127. COPY NÃO COPIA ASSET

Apenas:

```text
animation mapping
FPS
directions
```

---

# 128. TEMPLATE

Futuramente criar:

```text
Animation Templates
```

MVP pode oferecer pelo menos:

```text
4 directions / N frames
```

---

# 129. AUTO DETECT

O sistema pode detectar:

```text
dimensions
columns
rows
```

automaticamente.

Não tentar detectar semanticamente qual linha é North/South sem confirmação.

---

# 130. BULK CREATURE IMPORT FUTURO

Não implementar agora.

---

# 131. ERROR HANDLING

Mostrar erros como:

```text
Imagem não é múltipla de 32×32.

Frame 41 não existe.

Walk East não possui frames.

Frame duration inválida.
```

---

# 132. VALIDATION

Antes de salvar:

```text
spriteWidth > 0
spriteHeight > 0
frames exist
frame indexes valid
duration > 0
```

---

# 133. WALK REQUIREMENT

Preferência:

uma criatura ativa deve possuir pelo menos:

```text
walk south
```

ou animação fallback válida.

Mas não bloquear criaturas estáticas se design permitir.

---

# 134. CONFIG STATUS

Mostrar:

```text
Completo
Parcial
Sem animação
```

na lista de criaturas.

---

# 135. LISTA ADMIN

Exemplo:

```text
#1035 Dwarf             Completo
#1036 Dwarf Guard       Completo
#1037 Dragon            Parcial
#1038 Rat               Sem Sprite
```

---

# 136. THUMBNAIL

Mostrar primeiro frame como thumbnail.

---

# 137. TEST MODE

Criar botão:

```text
Testar no mapa
```

Abre sandbox interno simples.

---

# 138. TEST MAP

Mostrar uma área pequena com:

```text
grid
obstacles
```

e permitir clicar destinos.

---

# 139. PATH TEST

Criatura caminha até destino usando o pathfinding já existente.

Enquanto caminha:

```text
CreatureAnimator
```

deve selecionar direção e frames automaticamente.

---

# 140. NÃO DUPLICAR PATHFINDING

Editor visual apenas reutiliza movimento já existente.

---

# 141. EXEMPLO DE TESTE

Admin clica à direita.

Criatura:

```text
turn east
↓
play walk east
↓
move
↓
reach position
↓
idle east
```

---

# 142. TESTE NORTE

Mesmo princípio.

---

# 143. TROCA DE DIREÇÃO

Ao pathfinding mudar:

```text
east
→ south
```

animation muda imediatamente para:

```text
walk south
```

---

# 144. FRAME NÃO DEVE RESETAR EXCESSIVAMENTE

Ao manter mesma animation:

não reiniciar frame a cada atualização de posição.

---

# 145. TROCA DE DIRECTION

Pode reiniciar ou preservar fase da animação.

Preferência:

```text
preserve normalized animation progress
```

para suavidade.

---

# 146. CRIATURAS REPETIDAS

100 criaturas com mesmo CreatureID:

devem compartilhar:

```text
spritesheet texture
animation definition
```

e possuir apenas estado de animação individual.

---

# 147. NÃO DUPLICAR TEXTURA NA GPU/RAM

Cache.

---

# 148. PERFORMANCE

Animação é client-side.

Servidor não envia:

```text
frame 1
frame 2
frame 3
```

pela rede.

Servidor envia:

```text
position
direction
state/action
timestamps
```

Frontend anima.

---

# 149. MUITO IMPORTANTE

Não sincronizar cada frame pelo backend.

Isso seria desperdício.

---

# 150. NETWORK MODEL

Servidor envia algo como:

```json
{
  "entityId": "monster-55",
  "creatureId": 1035,
  "x": 12,
  "y": 8,
  "direction": "east",
  "movementState": "walking"
}
```

Frontend sabe quais frames usar através do Creature Registry.

---

# 151. ATTACK EVENT

Servidor:

```json
{
  "type": "monster.attack",
  "entityId": "monster-55",
  "startedAt": 123456789
}
```

Frontend executa animation `attack`.

---

# 152. CLIENT ANIMATION STATE

Não precisa persistir no banco.

É apresentação.

---

# 153. OFFLINE

Não simular animações offline.

Apenas lógica de combate.

---

# 154. RESPONSIVIDADE ADMIN

Ferramenta deve ser pensada para desktop.

Alvo:

```text
1920×1080
1600×900
1366×768
```

---

# 155. ZOOM DO EDITOR

Essencial porque sprite é 32×32.

---

# 156. PIXEL PERFECT

Nunca usar filtering linear nos sprites.

Se canvas:

```text
imageSmoothingEnabled = false
```

---

# 157. CSS

Se DOM:

```css
.sprite-preview {
  image-rendering: pixelated;
  image-rendering: crisp-edges;
}
```

---

# 158. COMPONENTES FRONTEND

Criar aproximadamente:

```text
CreatureAdminPage
CreatureList
CreatureEditor

CreatureAnimationEditor
SpriteSheetUploader
SpriteSheetInspector
SpriteGrid
SpriteFrame

AnimationGroupList
DirectionSelector
AnimationTimeline
AnimationFrameCard

AnimationPreview
AnimationPlaybackControls
AnimationZoomControls
AnimationPropertiesPanel

CreatureMovementSandbox
```

---

# 159. BACKEND

Criar/reutilizar:

```text
CreatureRegistry
CreatureAssetService
CreatureAnimationService
```

---

# 160. DATABASE

Adicionar:

```text
creatures
creature_sprite_assets
creature_animation_configs
```

se ainda não existirem.

---

# 161. CONFIG JSONB OU NORMALIZADO

Para animações, JSONB validado é adequado porque a estrutura é altamente configurável.

Creature core continua relacional.

---

# 162. INDEXES

Criar:

```text
creatures(creature_id)
creatures(slug)
creature_sprite_assets(creature_id)
creature_animation_configs(creature_id)
```

---

# 163. VERSION CONFLICT

Assim como Item Admin, impedir dois admins de sobrescrever configuração simultaneamente.

Usar:

```text
version
```

---

# 164. TESTE IMPORT 32×32

Imagem:

```text
128×256
```

Resultado:

```text
4 columns
8 rows
32 frames
```

---

# 165. TESTE FRAME CUT

Frame 0:

```text
x=0
y=0
32×32
```

Frame 1:

```text
x=32
y=0
```

---

# 166. TESTE NEXT ROW

Frame 4 em sheet 4 colunas:

```text
x=0
y=32
```

---

# 167. TESTE INVALID IMAGE

Imagem:

```text
130×256
```

com 32×32.

Mostrar erro ou permitir crop explicitamente.

Não cortar silenciosamente.

---

# 168. TESTE WALK

Config:

```text
frames 0–7
120ms
loop
```

Preview deve reproduzir em ordem.

---

# 169. TESTE LOOP

Após último:

```text
volta ao primeiro
```

---

# 170. TESTE NON LOOP

Attack:

após último:

```text
retorna idle/walk
```

---

# 171. TESTE PING PONG

```text
0 1 2 3 2 1
```

---

# 172. TESTE DIREÇÕES

Selecionar cada direção deve mostrar a sequência correspondente.

---

# 173. TESTE DRAG

Mover frame 4 antes de frame 2 deve alterar sequência.

---

# 174. TESTE DUPLICATE FRAME

Frame pode aparecer mais de uma vez.

---

# 175. TESTE SAVE

Fechar/reabrir editor deve preservar config.

---

# 176. TESTE LIVE GAME

CreatureID configurado deve utilizar nova animação no mapa real.

---

# 177. TESTE 50 CREATURES

Renderizar:

```text
50
100
200
```

criaturas animadas.

Medir FPS.

---

# 178. NÃO CRIAR DOM NODE DESNECESSÁRIO

Se jogo usa Canvas/WebGL:

animações ficam no renderer.

---

# 179. TESTE SHARED TEXTURE

50 Dwarfs:

```text
1 spritesheet texture
50 animation runtime states
```

---

# 180. TESTE NETWORK

Servidor não envia update por frame.

---

# 181. TESTE PATHFINDING

Criatura anda:

```text
south
east
north
west
```

e troca animação automaticamente.

---

# 182. TESTE STOP

Parou:

```text
walk → idle
```

---

# 183. TESTE ATTACK

Movendo:

```text
walk
```

ataque recebido:

```text
attack animation
```

termina:

```text
walk
```

se ainda movendo.

---

# 184. TESTE DEATH

Death interrompe qualquer outro estado.

---

# 185. CRITÉRIO DE ACEITE

A Central de Comando deve permitir pegar uma spritesheet de uma criatura semelhante à imagem fornecida e configurá-la completamente **sem editar código**.

---

# 186. CRITÉRIO DE ACEITE — SPRITE

Padrão:

```text
32×32
```

---

# 187. CRITÉRIO DE ACEITE — GRID

Sistema detecta quantidade de frames.

---

# 188. CRITÉRIO DE ACEITE — DIREÇÕES

Admin consegue configurar:

```text
North
East
South
West
```

---

# 189. CRITÉRIO DE ACEITE — ANIMAÇÕES

Admin consegue configurar:

```text
Idle
Walk
Attack
Cast
Hit
Death
```

quando disponíveis.

---

# 190. CRITÉRIO DE ACEITE — PREVIEW

Preview reproduz a sequência exatamente como aparecerá no jogo.

---

# 191. CRITÉRIO DE ACEITE — DRAG & DROP

Frames podem ser adicionados/reordenados visualmente.

---

# 192. CRITÉRIO DE ACEITE — DATABASE

Spritesheet e configuração persistem em PostgreSQL.

---

# 193. CRITÉRIO DE ACEITE — GAME ENGINE

O renderer usa a configuração cadastrada sem hardcode específico para Dwarf, Dragon, Rat etc.

---

# 194. CRITÉRIO DE ACEITE — PERFORMANCE

Servidor não controla frame de animação.

Frontend controla a apresentação.

---

# 195. CRITÉRIO DE ACEITE — TEXTURE CACHE

Criaturas iguais reutilizam a mesma textura.

---

# 196. RELATÓRIO FINAL

Ao concluir, apresentar:

```text
Arquivos criados
Arquivos alterados

Database
Migrations
Tables
Indexes

Admin APIs

Frontend Components

Creature Registry

Animation Engine

Sprite sheet configuration

Default sprite:
32×32

Directions:
North
East
South
West

Animations supported:
Idle
Walk
Attack
Cast
Hit
Death

Tests:
Total
Passed
Failed

Performance:
50 creatures
100 creatures
200 creatures

Build:
lint
typecheck
tests
backend
frontend
docker
```

Também demonstrar uma criatura importada através de uma spritesheet completa, configurando suas quatro direções, reproduzindo a caminhada no preview e usando a mesma configuração dentro do mapa real.

---

# 197. INSTRUÇÃO FINAL

Não desenvolva essa ferramenta como um simples visualizador de PNG.

Ela deve ser um **editor de animação data-driven para todas as criaturas do Aetheria Adle**.

O fluxo final deve ser:

```text
CREATURE ID
↓
SPRITESHEET
↓
32×32 FRAME CUTTER
↓
ANIMATION MAPPING
↓
DIRECTION MAPPING
↓
FRAME ORDER
↓
FRAME DURATION
↓
PREVIEW
↓
SAVE
↓
CREATURE REGISTRY
↓
GAME RENDERER
```

O servidor não deve dizer ao cliente:

```text
mostre frame 1
mostre frame 2
mostre frame 3
```

O servidor envia apenas o estado real:

```text
CreatureID
Position
Direction
Walking
Attacking
Casting
Dead
```

e o cliente usa a definição cadastrada na Central de Comando para reproduzir a animação correta a 60 FPS.

Isso permitirá cadastrar centenas ou milhares de criaturas diferentes sem criar lógica específica para cada uma delas.
