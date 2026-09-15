# PROMPT DE IMPLEMENTAÇÃO — PADRÃO DE FONTE E TEXTO DE COMBATE

Você está trabalhando no frontend/renderizador.

Precisamos padronizar a tipografia usada sobre o mundo do jogo, principalmente:

- nome dos jogadores;
- nome dos monstros;
- nomes de bosses;
- textos de dano;
- textos de cura;
- ganho de XP;
- ganho de gold;
- mensagens curtas de combate;
- palavras de magia exibidas sobre as entidades.

A referência visual utiliza uma fonte pequena, compacta, forte e altamente legível, semelhante ao estilo clássico de MMORPGs 2D.

O objetivo é reproduzir essa sensação visual utilizando uma stack baseada em:

Tahoma
Verdana
Arial
sans-serif

com preferência para Tahoma.

==================================================
1. FONTE PADRÃO DO MUNDO
==================================================

Criar uma constante/configuração central:

WORLD_TEXT_STYLE

Fonte:

font-family:
Tahoma, Verdana, Arial, sans-serif

Peso:

700

Tamanho base:

13px

==================================================
2. IMPORTANTE
==================================================

Esse padrão deve ser usado apenas para textos que aparecem dentro ou sobre o mundo do jogo.

Não substituir obrigatoriamente a fonte dos menus administrativos ou interface inteira.

Separar:

UI FONT

de:

WORLD / COMBAT FONT

==================================================
3. CSS BASE
==================================================

Se algum texto for renderizado em DOM:

.world-text {
  font-family:
    Tahoma,
    Verdana,
    Arial,
    sans-serif;

  font-size: 13px;
  font-weight: 700;

  line-height: 1;

  white-space: nowrap;

  text-rendering: optimizeSpeed;

  -webkit-font-smoothing: none;
}

==================================================
4. CONTORNO
==================================================

Todo texto sobre o mapa deve possuir contorno escuro.

Isso é obrigatório para manter leitura sobre:

- grama;
- pedra;
- água;
- lava;
- criaturas;
- efeitos;
- magias.

Usar:

-webkit-text-stroke: 1px #000;

e/ou:

text-shadow:
  -1px -1px 0 #000,
   1px -1px 0 #000,
  -1px  1px 0 #000,
   1px  1px 0 #000;

==================================================
5. NÃO USAR SOMBRA SUAVE
==================================================

Evitar:

blur
box-shadow suave
glow excessivo

Queremos um contorno duro e legível.

==================================================
6. CANVAS
==================================================

Se os textos forem renderizados no Canvas/Game Renderer, não depender de CSS.

Criar helper:

drawOutlinedText()

Exemplo conceitual:

function drawOutlinedText(
  ctx,
  text,
  x,
  y,
  fillColor,
  options
) {
  ctx.font =
    "700 13px Tahoma, Verdana, Arial, sans-serif";

  ctx.textAlign =
    options.align ?? "center";

  ctx.textBaseline =
    "middle";

  ctx.lineWidth =
    options.strokeWidth ?? 3;

  ctx.strokeStyle =
    "#000000";

  ctx.strokeText(
    text,
    x,
    y
  );

  ctx.fillStyle =
    fillColor;

  ctx.fillText(
    text,
    x,
    y
  );
}

==================================================
7. OBSERVAÇÃO SOBRE CANVAS
==================================================

No Canvas:

strokeWidth entre 2 e 3 px pode ficar visualmente semelhante a um outline de 1 px dependendo de DPI.

Calibrar visualmente.

==================================================
8. NOMES DOS JOGADORES
==================================================

Player Name:

fonte:
Tahoma Bold

tamanho:
13px

peso:
700

cor padrão:
branco ou verde claro conforme design atual

outline:
preto

==================================================
9. POSICIONAMENTO DO PLAYER NAME
==================================================

Usar o sistema já definido:

renderBounds
+
anchor visual.

Nome deve ficar acima do sprite real.

Não usar apenas o tile 32x32.

==================================================
10. MONSTER NAME
==================================================

Nome de criatura:

font:
Tahoma Bold

size:
12–13px

weight:
700

outline:
preto

==================================================
11. COR DE MONSTER NAME
==================================================

Sugestão:

monstro normal:
verde claro / branco esverdeado

boss:
vermelho

target selecionado:
pode receber cor ou destaque adicional

Centralizar configuração.

==================================================
12. PLAYER NAME COLOR
==================================================

Criar configuração:

WORLD_TEXT_COLORS = {
  playerName: "#FFFFFF",
  partyMemberName: "#67E36F",
  monsterName: "#59E36B",
  bossName: "#FF4A4A"
}

Ajustar às cores já existentes do Avalon Adle.

==================================================
13. DAMAGE TEXT
==================================================

Floating damage deve usar exatamente a mesma família tipográfica.

Normal:

font-size:
13px

font-weight:
700

outline:
preto

==================================================
14. CRITICAL DAMAGE
==================================================

Critical:

font-size:
16px

font-weight:
700 ou 800

Não trocar a fonte.

A diferença visual vem de:

- tamanho;
- scale animation;
- peso;
- movimento.

==================================================
15. HEALING
==================================================

Healing:

+250

Fonte:

Tahoma Bold
13–14px

Cor:

verde.

Outline:

preto.

==================================================
16. XP
==================================================

Quando ganhar XP:

+1.250 XP

ou formato adotado pelo jogo.

Usar:

Tahoma Bold

size:
13px

color:
azul claro/ciano ou dourado conforme identidade definida.

==================================================
17. GOLD
==================================================

Exemplo:

+409 gold

Usar mesma tipografia.

Cor:

dourado/amarelo.

==================================================
18. DAMAGE TYPE COLORS
==================================================

Manter integração com o Damage Type System.

Exemplo:

physical:
cinza/branco

fire:
vermelho/laranja

ice:
azul/ciano

energy:
roxo

earth:
verde

holy:
amarelo

death:
magenta/roxo

arcane:
azul violeta

healing:
verde vivo

XP:
ciano/dourado

Gold:
dourado

==================================================
19. CONFIG CENTRAL
==================================================

Criar:

WORLD_TEXT_THEME

Exemplo:

const WORLD_TEXT_THEME = {
  fontFamily:
    "Tahoma, Verdana, Arial, sans-serif",

  fontWeight: 700,

  sizes: {
    entityName: 13,
    monsterName: 12,
    bossName: 14,

    damage: 13,
    criticalDamage: 16,

    healing: 14,

    xp: 13,
    gold: 13,

    spellWords: 13
  },

  stroke: {
    color: "#000000",
    width: 3
  }
};

==================================================
20. NÃO HARDCODE EM CADA COMPONENTE
==================================================

Não criar estilos separados manualmente com valores repetidos em:

MonsterRenderer
PlayerRenderer
CombatTextRenderer
XPTextRenderer

Todos devem consumir:

WORLD_TEXT_THEME.

==================================================
21. WORLD TEXT RENDERER
==================================================

Criar um helper/componente único:

WorldTextRenderer

Responsável por desenhar:

entity names
damage
healing
xp
gold
spell words

==================================================
22. ESTRUTURA
==================================================

interface WorldTextStyle {
  fontFamily: string;

  fontSize: number;

  fontWeight: number;

  fillColor: string;

  strokeColor: string;

  strokeWidth: number;

  align:
    | "left"
    | "center"
    | "right";
}

==================================================
23. PRESETS
==================================================

Criar presets:

PLAYER_NAME_STYLE
MONSTER_NAME_STYLE
BOSS_NAME_STYLE

DAMAGE_STYLE
CRITICAL_DAMAGE_STYLE
HEAL_STYLE
XP_STYLE
GOLD_STYLE
SPELL_WORD_STYLE

==================================================
24. PLAYER NAME
==================================================

Preset:

font:
Tahoma

weight:
700

size:
13px

stroke:
black

==================================================
25. MONSTER NAME
==================================================

Preset:

font:
Tahoma

weight:
700

size:
12px

stroke:
black

==================================================
26. BOSS NAME
==================================================

Preset:

font:
Tahoma

weight:
700

size:
14px

stroke:
black

color:
red

==================================================
27. DAMAGE
==================================================

Preset:

Tahoma
700
13px

dynamic fillColor based on DamageType.

==================================================
28. CRITICAL
==================================================

Tahoma
800
16px

dynamic DamageType color.

==================================================
29. XP
==================================================

Tahoma
700
13px

==================================================
30. GOLD
==================================================

Tahoma
700
13px

==================================================
31. SPELL WORDS
==================================================

Exemplo:

exori gran
exura vita

Fonte:

Tahoma Bold

size:
13px

cor:
amarelo/laranja

outline:
black.

==================================================
32. NÃO ESCALAR FONTE JUNTO COM SPRITE
==================================================

Muito importante.

Se câmera estiver:

0.8x
1x
1.2x

não necessariamente multiplicar a fonte pelo mesmo zoom.

O texto precisa continuar legível.

==================================================
33. WORLD-SCALE MODE
==================================================

Criar opção:

scaleWithCamera

Para nomes e combat text:

recomendação inicial:

false ou limitado.

==================================================
34. CLAMP
==================================================

Se escolher escalar:

fontSize =
clamp(
  baseSize * cameraZoom,
  minSize,
  maxSize
)

Exemplo:

min:
11px

max:
16px

==================================================
35. CRIATURAS GRANDES
==================================================

Não aumentar automaticamente o tamanho do nome porque o sprite é 96x96.

Nome usa tamanho de texto consistente.

Boss pode ter preset próprio.

==================================================
36. POSICIONAMENTO
==================================================

Nome:

renderBounds.top - margin

Healthbar:

renderBounds.top - healthBarMargin

Damage:

center/head socket

XP/Gold:

pode usar player position ou posição do evento.

==================================================
37. FLOATING COMBAT TEXT
==================================================

O sistema já possui:

CombatTextManager.

Atualizar para utilizar:

WORLD_TEXT_THEME

em vez de estilos próprios.

==================================================
38. DAMAGE STACK
==================================================

Quando vários hits aparecem:

-767
-612
-463
-286

todos devem usar a mesma fonte e outline.

==================================================
39. ALINHAMENTO
==================================================

Dano:

center.

Nome:

center.

XP:

center.

Gold:

center.

==================================================
40. FORMATAÇÃO
==================================================

Valores devem ser compactos.

Exemplo:

-150
-1.250
-12.500

+250
+2.000

+409 gold

+1.250 XP

==================================================
41. NÃO USAR FONTES DIFERENTES POR ELEMENTO
==================================================

DamageType muda:

cor

e eventualmente animação.

Não muda:

font-family.

==================================================
42. PIXEL ART
==================================================

Apesar de usar Tahoma/Verdana, o resultado deve preservar aparência de MMORPG clássico.

Evitar:

font smoothing excessivo
drop shadow moderno
glow
blur.

==================================================
43. HIGH DPI
==================================================

Verificar DPR.

Canvas interno pode possuir alta resolução.

Mas o texto deve manter tamanho CSS/logical correto.

==================================================
44. DEVICE PIXEL RATIO
==================================================

Não deixar:

13px
virar visualmente
26px

porque DPR = 2.

DPR serve apenas para nitidez.

==================================================
45. FALLBACK
==================================================

Se Tahoma não estiver disponível:

Verdana.

Depois:

Arial.

Depois:

sans-serif.

==================================================
46. NÃO BAIXAR FONTE EXTERNA
==================================================

Não precisamos adicionar uma fonte web obrigatória nesta fase.

Utilizar stack do sistema.

==================================================
47. CONFIGURAÇÃO FUTURA
==================================================

Preparar:

Settings
→ Interface
→ Combat Text Size

Pequeno
Normal
Grande

==================================================
48. NORMAL
==================================================

Base:
13px.

==================================================
49. SMALL
==================================================

11–12px.

==================================================
50. LARGE
==================================================

15–16px.

==================================================
51. NOME DE PLAYER E MONSTER
==================================================

Essa preferência não precisa necessariamente alterar entity names.

Pode inicialmente controlar somente floating texts.

==================================================
52. PERFORMANCE
==================================================

Não recriar objetos de estilo por frame.

Presets devem ser constantes/cacheados.

==================================================
53. TEXT METRICS
==================================================

Se precisar calcular largura do nome:

cachear medidas quando o nome não muda.

==================================================
54. NÃO MEDIR TEXT 60X/S
==================================================

Nome da criatura:

mede uma vez.

Damage values são transitórios, mas podem usar renderer direto.

==================================================
55. PIXIJS
==================================================

Se o projeto usa PixiJS:

criar/reutilizar TextStyle ou BitmapText equivalente.

Não instanciar TextStyle em todo frame.

==================================================
56. BITMAP FONT FUTURA
==================================================

Preparar arquitetura para no futuro trocar para uma bitmap font própria do Avalon.

Mas agora usar:

Tahoma/Verdana.

==================================================
57. SE USAR BITMAP FONT FUTURAMENTE
==================================================

WorldTextRenderer deve permitir trocar implementação sem alterar Combat Engine.

==================================================
58. NÃO MISTURAR COM COMBAT ENGINE
==================================================

Combat Engine envia:

amount
damageType
critical.

Renderer decide:

font
color
outline
animation.

==================================================
59. EXEMPLO DAMAGE EVENT
==================================================

{
  "amount": 767,
  "damageType": "ice",
  "critical": false
}

Renderer:

text:
"-767"

font:
Tahoma Bold 13

color:
ice

stroke:
black.

==================================================
60. XP EVENT
==================================================

{
  "amount": 1250
}

Renderer:

"+1.250 XP"

==================================================
61. GOLD EVENT
==================================================

{
  "amount": 409
}

Renderer:

"+409 gold"

==================================================
62. TESTE VISUAL
==================================================

Criar uma cena com:

Player:
Gryllo

Monster:
Wyrm

Boss:
Elder Wyrm

e mostrar simultaneamente:

-546
-1.890
+240
+709 XP
+409 gold

==================================================
63. TESTE SOBRE DIFERENTES FUNDOS
==================================================

Validar em:

grass
stone
water
lava
dark dungeon
bright floor

Todo texto deve continuar legível.

==================================================
64. TESTE EM COMBATE LOTADO
==================================================

Testar:

10 monsters
multiple AoE
healing
XP
gold

A fonte deve continuar compacta o bastante para não dominar a tela.

==================================================
65. RESULTADO ESPERADO
==================================================

O resultado deve ter aparência semelhante ao padrão visual clássico de MMORPGs 2D:

pequeno;
forte;
compacto;
contorno preto;
cores vivas;
alta legibilidade.

==================================================
66. CRITÉRIO DE ACEITE
==================================================

Player Name:
Tahoma/Verdana stack.

Monster Name:
mesma stack.

Boss Name:
mesma stack.

Damage:
mesma stack.

Healing:
mesma stack.

XP:
mesma stack.

Gold:
mesma stack.

Spell Words:
mesma stack.

==================================================
67. CRITÉRIO DE ACEITE — OUTLINE
==================================================

Todos os textos de mundo devem permanecer legíveis sobre fundos claros e escuros.

==================================================
68. CRITÉRIO DE ACEITE — PERFORMANCE
==================================================

Nenhum objeto de fonte/estilo pesado deve ser criado a cada render frame.

==================================================
69. CRITÉRIO DE ACEITE — POSICIONAMENTO
==================================================

Nome de criaturas grandes continua corretamente acima do sprite.

Floating damage nasce próximo ao corpo.

==================================================
70. INSTRUÇÃO FINAL
==================================================

Padronizar toda a tipografia sobre o mundo do Avalon Adle utilizando:

Tahoma
→ Verdana
→ Arial
→ sans-serif

com peso forte e outline preto.

O objetivo é que:

Gryllo
Wyrm
Dragon
-767
+250
+709 XP
+409 gold
exori gran

pareçam pertencer ao mesmo sistema visual.

A referência estética é um MMORPG 2D clássico:

fontes compactas;
cores fortes;
outline escuro;
alta legibilidade;
pouca suavização;
nenhum blur.

Não alterar as fórmulas ou eventos de combate.

Esta implementação é estritamente visual e deve ser centralizada no WorldTextRenderer / WorldTextTheme.