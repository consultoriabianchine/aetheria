# IMPLEMENTAÇÃO — COLISÃO, MOVIMENTAÇÃO FLUIDA, IA INDEPENDENTE E PRIORIDADE DE ALVOS NAS HUNTS 

Você está trabalhando no sistema de movimentação, pathfinding, colisão e IA de combate.

Atualmente existem dois problemas principais:

1. Jogadores e criaturas não possuem colisão adequada entre si.
2. A movimentação das Hunts está excessivamente sincronizada e robótica, parecendo que todos os monstros marcham juntos.
3. O movimento dos jogadores também apresenta comportamento de “anda, para, anda, para”, causando sensação artificial.

Precisamos transformar o sistema em um comportamento muito mais natural, fluido e independente.

O objetivo é fazer com que cada criatura pareça possuir sua própria IA, mesmo utilizando o mesmo sistema de Hunt.

==================================================
1. COLISÃO ENTRE ENTIDADES
==================================================

Jogadores e criaturas devem possuir colisão lógica.

Um jogador NÃO pode atravessar:

- outra criatura;
- outro jogador, caso a regra do mapa assim determine;
- obstáculos;
- paredes;
- tiles bloqueados.

Uma criatura NÃO pode atravessar:

- jogadores;
- outras criaturas;
- obstáculos;
- paredes;
- tiles bloqueados.

Regra principal:

PLAYER
≠ atravessa MONSTER

MONSTER
≠ atravessa PLAYER

MONSTER
≠ atravessa MONSTER

==================================================
2. FOOTPRINT
==================================================

A colisão deve utilizar o footprint lógico já definido.

Exemplo:

sprite:
96x96

footprint:
1x1

A criatura continua bloqueando somente seu footprint 1x1.

Não utilizar tamanho visual completo do sprite para colisão.

==================================================
3. OCCUPANCY GRID
==================================================

Criar/reutilizar um sistema de ocupação do grid.

Cada tile deve conseguir responder:

- está bloqueado pelo mapa?
- está ocupado por player?
- está ocupado por monster?
- está reservado por entidade em movimento?

Exemplo:

isTileWalkable(x, y)
isTileOccupied(x, y)
isTileReserved(x, y)

==================================================
4. RESERVA DE TILE
==================================================

Para evitar duas criaturas tentando entrar no mesmo tile simultaneamente:

quando uma entidade decide andar para um tile:

reservar temporariamente o destino.

Exemplo:

Monster A:
quer tile 10,10

Monster B:
quer tile 10,10

A consegue reservar primeiro.

B precisa:

- procurar outro caminho;
- esperar pequeno intervalo;
- escolher outro tile válido.

==================================================
5. NÃO BLOQUEAR ENTIDADES PARA SEMPRE
==================================================

Reserva deve expirar ou ser liberada quando:

- movimento termina;
- movimento é cancelado;
- path muda;
- entidade morre;
- entidade troca de alvo.

==================================================
6. MOVIMENTAÇÃO INDEPENDENTE DOS MONSTROS
==================================================

Atualmente os monstros parecem andar sincronizados.

Isso deve ser removido.

Cada criatura deve possuir estado individual:

MonsterMovementState {
  targetId
  currentPath
  nextTile
  movementStartedAt
  movementDuration
  repathAt
  blockedSince
  preferredDistance
  localDecisionOffset
}

==================================================
7. NÃO USAR LOOP SINCRONIZADO PARA TODOS
==================================================

Evitar:

a cada 500ms
→ todos os monstros recalculam caminho
→ todos dão um passo

Isso cria efeito de marcha.

==================================================
8. DECISÕES EM MOMENTOS DIFERENTES
==================================================

Cada criatura deve possuir seu próprio:

nextDecisionAt
nextRepathAt

Exemplo:

Monster A:
repath em 220ms

Monster B:
repath em 410ms

Monster C:
repath em 315ms

Isso quebra a sincronização visual.

==================================================
9. JITTER CONTROLADO
==================================================

Pode existir pequena variação de timing por criatura.

Exemplo:

baseRepathInterval:
300ms

jitter:
±80ms

Mas isso não deve ser aleatoriedade descontrolada.

Usar RNG determinístico do runtime.

==================================================
10. MOVIMENTO CONTÍNUO
==================================================

O movimento deve ser interpolado continuamente.

Não:

tile
→ para
→ tile
→ para

Mas:

tile
────────→
próximo tile
────────→
próximo tile

==================================================
11. NÃO PARAR ENTRE STEPS
==================================================

Se já existe próximo nó válido no path:

a entidade deve continuar a transição sem pausa artificial.

==================================================
12. INTERPOLAÇÃO
==================================================

Durante movimento:

progress =
(currentTime - movementStartedAt)
/
movementDuration

Interpolar:

worldBaseX
worldBaseY

entre tile atual e próximo tile.

==================================================
13. MOVIMENTO DO PLAYER
==================================================

Aplicar o mesmo princípio aos jogadores.

Quando o jogador possui um path com vários tiles:

não executar:

andar 1 tile
parar
andar 1 tile
parar

Executar uma sequência contínua.

==================================================
14. PLAYER PATH
==================================================

Exemplo:

A
→ B
→ C
→ D
→ E

A transição deve parecer:

A────────B────────C────────D────────E

e não:

A→B
pause
B→C
pause
C→D

==================================================
15. ANIMAÇÃO
==================================================

Enquanto entidade estiver se deslocando:

animation = WALK

Não reiniciar a animação a cada tile.

==================================================
16. WALK CYCLE CONTÍNUO
==================================================

O Walk Animation deve manter progresso enquanto:

movementState == moving

Só retornar para Idle quando:

- path terminou;
- entidade decidiu parar;
- entidade está atacando sem movimentação;
- entidade ficou realmente bloqueada.

==================================================
17. TROCA DE DIREÇÃO
==================================================

Ao mudar de direção:

North
→ East

trocar frames correspondentes sem parar movimento.

==================================================
18. VELOCIDADE
==================================================

Movimento deve utilizar velocidade por entidade.

Exemplo:

movementSpeedTilesPerSecond

Não usar um único delay de step global.

==================================================
19. MONSTROS NÃO DEVEM ANDAR EM FORMAÇÃO
==================================================

Mesmo monstros com mesma velocidade e mesmo alvo não devem obrigatoriamente produzir o mesmo trajeto.

Adicionar local avoidance.

==================================================
20. LOCAL AVOIDANCE
==================================================

Quando dois monstros estão seguindo o mesmo alvo:

eles devem tentar ocupar tiles diferentes ao redor dele.

Evitar:

fila perfeita;
coluna perfeita;
todos no mesmo eixo.

==================================================
21. DESTINATION SLOTS AO REDOR DO ALVO
==================================================

Para melee, gerar tiles de aproximação ao redor do player.

Exemplo:

[1][2][3]
[4][P][5]
[6][7][8]

P = player.

Monstros tentam reservar posições diferentes.

==================================================
22. NÃO EMPILHAR MELEE
==================================================

Se tile adjacente está ocupado:

procurar outro tile adjacente.

Se todos estiverem ocupados:

aguardar ou buscar alternativa.

==================================================
23. RANGED CREATURES
==================================================

Criaturas ranged não precisam chegar adjacentes.

Elas podem tentar manter:

preferredRange

Exemplo:

3–5 tiles.

==================================================
24. RANGED POSITIONING
==================================================

Se estiver perto demais:

recuar.

Se estiver longe demais:

aproximar.

Se estiver em boa distância:

parar e atacar.

==================================================
25. TARGET PRIORITY
==================================================

Criaturas devem priorizar jogadores pela seguinte ordem:

1. Warrior
2. Archer
3. Mage

Essa é a prioridade base de alvo.

==================================================
26. IMPORTANTE
==================================================

Não significa que todos os monstros obrigatoriamente perseguem o Warrior para sempre.

A prioridade deve considerar:

- alvo vivo;
- alvo alcançável;
- existência de caminho;
- distância;
- line of sight quando necessário;
- bloqueios;
- capacidade da criatura de atacar aquele alvo.

==================================================
27. TARGET SCORE
==================================================

Criar sistema de pontuação.

Exemplo conceitual:

Warrior:
+300 priority

Archer:
+200

Mage:
+100

Depois combinar com:

distance
path availability
current target stickiness
blocked penalty

==================================================
28. EXEMPLO
==================================================

Warrior:
prioridade alta
mas sem caminho possível.

Archer:
prioridade menor
mas alcançável.

Resultado:

Monster pode trocar para Archer.

==================================================
29. TARGET SELECTION
==================================================

Criar função:

selectBestTarget(monster, players, context)

==================================================
30. TARGET VALIDATION
==================================================

Um alvo é válido se:

alive
active
same combat instance
attackable
within awareness area
reachable ou atacável à distância

==================================================
31. FOCO NO PRIMEIRO JOGADOR LOCALIZADO
==================================================

Dentro da prioridade de classe, se houver vários jogadores equivalentes:

preferir inicialmente:

- o primeiro detectado;
- o mais próximo;
- ou o target atual.

Recomendação:

usar score com estabilidade.

==================================================
32. TARGET STICKINESS
==================================================

Evitar troca de alvo a cada frame.

Adicionar:

targetStickinessBonus

Se current target continua válido:

dar bônus.

Isso evita comportamento nervoso.

==================================================
33. TROCAR ALVO QUANDO BLOQUEADO
==================================================

Se a criatura está tentando alcançar um jogador mas o caminho está bloqueado por tempo relevante:

ela pode procurar outro alvo.

==================================================
34. BLOCKED TIMER
==================================================

Criar:

blockedSince

Se:

now - blockedSince > blockedThreshold

reavaliar alvo.

Exemplo inicial:

500–1000ms

configurável.

==================================================
35. NÃO TROCAR AO PRIMEIRO BLOQUEIO
==================================================

Um bloqueio momentâneo causado por outro monstro não deve fazer troca instantânea.

Tentar primeiro:

1. outro tile;
2. pequeno repath;
3. local avoidance;
4. novo caminho.

Só depois considerar outro player.

==================================================
36. TARGET FALLBACK
==================================================

Ordem sugerida:

Warrior alcançável
↓
Archer alcançável
↓
Mage alcançável
↓
qualquer player válido
↓
esperar/reposition

==================================================
37. EXEMPLO
==================================================

Party:

Warrior
Archer
Mage

Monster A:

Warrior acessível
→ Warrior.

Monster B:

caminho para Warrior bloqueado permanentemente
→ Archer.

Monster C:

Warrior e Archer bloqueados
→ Mage.

==================================================
38. RANGED TARGETING
==================================================

Uma criatura ranged pode manter Warrior como alvo mesmo sem path melee, desde que tenha:

range válido
line of sight

==================================================
39. MELEE TARGETING
==================================================

Melee precisa encontrar tile adjacente possível.

Se não houver:

repath.

Depois de bloqueio persistente:

trocar alvo.

==================================================
40. NÃO IGNORAR COLISÃO PARA “CHEGAR NO ALVO”
==================================================

É proibido simplesmente permitir atravessar criaturas quando path falhar.

==================================================
41. CROWD BEHAVIOR
==================================================

Em packs grandes, monstros devem se distribuir.

Exemplo visual esperado:

       M
    M  W  M
      M M

em vez de:

M M M M M
    |
    W

==================================================
42. PATH VARIATION
==================================================

Quando existem caminhos de custo semelhante:

permitir pequena variação de escolha.

Isso evita todos selecionarem exatamente os mesmos nós.

==================================================
43. NÃO SACRIFICAR PATHFINDING
==================================================

A variação não pode gerar caminhos absurdos.

Só escolher entre alternativas próximas do melhor custo.

==================================================
44. PATHFINDING
==================================================

Pode usar:

A*
ou
algoritmo existente.

Adicionar:

dynamic occupancy cost

==================================================
45. STATIC VS DYNAMIC BLOCKERS
==================================================

Static blockers:

walls
water
rocks
map collision

Dynamic blockers:

players
monsters
reserved tiles

==================================================
46. PATH COST
==================================================

Tile livre:
normal.

Tile reservado:
alto custo ou bloqueado.

Tile ocupado:
bloqueado.

==================================================
47. TEMPORARY BLOCKING
==================================================

Se um monster bloqueia caminho:

não recalcular path global pesado imediatamente.

Pode tentar:

local detour.

==================================================
48. REPATH
==================================================

Recalcular path quando:

target mudou
path inválido
next tile bloqueado
target moveu significativamente
repath interval expirou

==================================================
49. NÃO REPATH A CADA FRAME
==================================================

Isso é obrigatório.

==================================================
50. SERVER PERFORMANCE
==================================================

Não calcular A* 60 vezes por segundo por criatura.

Usar:

event-driven
+
repath intervals
+
local steering

==================================================
51. PATH CACHE
==================================================

Pode reutilizar resultados quando apropriado.

Mas cuidado com blockers dinâmicos.

==================================================
52. MOVEMENT ENGINE
==================================================

Separar:

AI Decision
Pathfinding
Movement
Collision
Animation

==================================================
53. PIPELINE
==================================================

MONSTER AI
↓
SELECT TARGET
↓
DESIRED POSITION
↓
PATHFINDING
↓
LOCAL AVOIDANCE
↓
RESERVE NEXT TILE
↓
MOVEMENT INTERPOLATION
↓
COLLISION COMMIT
↓
CONTINUE PATH

==================================================
54. PLAYER PIPELINE
==================================================

PLAYER DESTINATION
↓
PATH
↓
RESERVE NEXT TILE
↓
INTERPOLATE
↓
COMMIT TILE
↓
CONTINUE

==================================================
55. TICK VISUAL VS LOGICAL
==================================================

Frontend pode animar a 60 FPS.

Servidor não precisa fazer movimento completo a 60Hz.

Servidor mantém:

movementStartedAt
movementEndsAt
fromTile
toTile

==================================================
56. CLIENT INTERPOLATION
==================================================

Cliente recebe movimento e interpola visualmente.

Isso ajuda muito a remover o efeito:

anda
para
anda
para.

==================================================
57. SERVER AUTHORITATIVE
==================================================

Cliente não decide colisão.

Servidor valida destino.

==================================================
58. MOVEMENT EVENT
==================================================

Exemplo:

{
  entityId,
  fromX,
  fromY,
  toX,
  toY,
  startedAt,
  endsAt,
  direction
}

==================================================
59. CLIENT
==================================================

Interpola entre os pontos usando timestamps.

==================================================
60. NÃO ENVIAR POSIÇÃO 60 VEZES POR SEGUNDO
==================================================

Enviar:

movement start
movement correction
movement stop
target/path events relevantes

==================================================
61. CORREÇÃO DE REDE
==================================================

Se houver divergência:

server snapshot corrige.

==================================================
62. MONSTER PERSONALITY OFFSET
==================================================

Para evitar comportamento idêntico:

cada monster runtime pode possuir:

movementDecisionOffset
repathJitter
preferredSide
targetStickiness

gerados no spawn.

==================================================
63. PREFERRED SIDE
==================================================

Exemplo:

alguns monstros tendem a contornar pela esquerda.

outros pela direita.

Isso ajuda a quebrar a marcha sincronizada.

==================================================
64. NÃO CRIAR “IA ALEATÓRIA”
==================================================

A criatura ainda deve agir racionalmente.

A variação é pequena e controlada.

==================================================
65. ATTACK + MOVEMENT
==================================================

Quando alvo entra no alcance:

monster pode atacar sem precisar parar artificialmente por muito tempo.

==================================================
66. MELEE
==================================================

Se chegou adjacente:

stop movement
attack

Após ataque:

se alvo saiu:
retomar movimento imediatamente.

==================================================
67. RANGED
==================================================

Se target está em range:

pode parar e atacar.

Se target começa a se afastar:

reposition.

==================================================
68. PLAYER AUTO MOVEMENT
==================================================

Se players possuem movimento automático de combate:

aplicar as mesmas melhorias.

==================================================
69. PLAYER NÃO DEVE “PENSAR” EM PASSOS VISÍVEIS
==================================================

A lógica pode continuar baseada em tiles.

Mas visualmente a trajetória precisa ser contínua.

==================================================
70. MOVEMENT EASING
==================================================

Para movimento de tile a tile:

preferir linear ou easing muito leve.

Não usar:

ease-in-out forte

porque dá sensação de acelerar/frear a cada tile.

==================================================
71. RECOMENDAÇÃO
==================================================

Usar:

linear

para deslocamento principal.

Animation do sprite dá sensação orgânica.

==================================================
72. WALK ANIMATION SPEED
==================================================

Sincronizar aproximadamente com movement speed.

==================================================
73. NÃO REINICIAR WALK FRAME
==================================================

A cada novo tile:

não voltar para frame 0.

==================================================
74. COLLISION COMMIT
==================================================

Quando movimento termina:

liberar tile anterior
ocupar novo tile
liberar reservation

de forma atômica no runtime.

==================================================
75. SWAP
==================================================

Evitar duas entidades trocarem de tile simultaneamente atravessando uma à outra.

Exemplo:

A → B
B → A

Isso deve ser bloqueado ou resolvido explicitamente.

==================================================
76. HEAD-ON COLLISION
==================================================

Se duas entidades se encontram frontalmente:

uma deve ceder/repath.

Nunca atravessar.

==================================================
77. DEAD ENTITIES
==================================================

Ao morrer:

liberar imediatamente occupancy/reservations conforme regra de corpse.

==================================================
78. CORPSE
==================================================

Se cadáver não bloqueia:

não manter colisão.

==================================================
79. TELEPORT
==================================================

Se existir teleport:

atualizar occupancy atomicamente.

==================================================
80. DEBUG MODE
==================================================

Criar:

SHOW_MOVEMENT_DEBUG

==================================================
81. DEBUG VISUAL
==================================================

Mostrar:

current tile
reserved tile
target
current path
blocked state
target score
repath timer

==================================================
82. CORES DEBUG
==================================================

Green:
current tile

Yellow:
reserved tile

Blue:
path

Red:
blocked tile

Line:
monster → target

==================================================
83. DEBUG DE TARGET
==================================================

Exemplo:

Target:
Warrior #10

Score:
420

Distance:
4

Reachable:
true

Blocked:
false

==================================================
84. TESTE 1 — COLISÃO
==================================================

Player tenta atravessar Monster.

Resultado:

bloqueado.

==================================================
85. TESTE 2
==================================================

Monster tenta atravessar Player.

Resultado:

bloqueado.

==================================================
86. TESTE 3
==================================================

Monster tenta atravessar Monster.

Resultado:

bloqueado/repath.

==================================================
87. TESTE 4 — 10 MONSTROS
==================================================

Spawnar 10 monsters simultaneamente.

Eles NÃO devem:

andar em perfeita sincronia;
usar exatamente mesmo caminho;
formar uma coluna artificial.

==================================================
88. TESTE 5 — PARTY
==================================================

Warrior
Archer
Mage.

Todos acessíveis.

Monsters devem priorizar Warrior.

==================================================
89. TESTE 6
==================================================

Warrior completamente inacessível.

Archer acessível.

Monster deve trocar para Archer.

==================================================
90. TESTE 7
==================================================

Warrior e Archer inacessíveis.

Mage acessível.

→ Mage.

==================================================
91. TESTE 8
==================================================

Warrior temporariamente bloqueado por outro monster por 200ms.

Não trocar imediatamente.

==================================================
92. TESTE 9
==================================================

Warrior bloqueado persistentemente.

Após threshold:

reavaliar target.

==================================================
93. TESTE 10 — MOVIMENTO PLAYER
==================================================

Path de 10 tiles.

Player deve atravessar trajetória visualmente contínua.

==================================================
94. TESTE 11 — MOVIMENTO MONSTER
==================================================

Mesmo teste.

Nenhuma pausa perceptível entre tiles normais.

==================================================
95. TESTE 12 — DIREÇÃO
==================================================

Path:

East
East
South
South
West

animação muda direção sem parar.

==================================================
96. TESTE 13 — TILE RESERVATION
==================================================

Dois monstros tentam entrar no mesmo tile.

Somente um consegue.

==================================================
97. TESTE 14 — HEAD-ON
==================================================

Dois monsters vindo em sentidos opostos.

Não atravessam um ao outro.

==================================================
98. TESTE 15 — RANGED
==================================================

Archer monster mantém distância e ataca sem tentar colar no player.

==================================================
99. TESTE 16 — MELEE
==================================================

Melee procura um dos tiles livres adjacentes ao target.

==================================================
100. TESTE 17 — PACK GRANDE
==================================================

20+ monsters.

Validar:

CPU
path calculations/sec
repath/sec
collision checks/sec

==================================================
101. PERFORMANCE
==================================================

Não resolver fluidez aumentando servidor para 60Hz completo.

A solução correta é:

- movimento temporal;
- interpolation;
- decisões independentes;
- reservation;
- pathfinding assíncrono/event-driven;
- local avoidance.

==================================================
102. NÃO USAR SETINTERVAL POR MONSTER
==================================================

Cada entidade deve possuir timestamps dentro do runtime.

==================================================
103. IMPLEMENTATION ORDER
==================================================

Etapa 1
Auditar Movement Engine atual.

Etapa 2
Separar tile position de visual movement.

Etapa 3
Criar Occupancy Grid.

Etapa 4
Adicionar Entity Collision.

Etapa 5
Adicionar Tile Reservation.

Etapa 6
Corrigir player movement interpolation.

Etapa 7
Corrigir monster movement interpolation.

Etapa 8
Remover pausas artificiais entre steps.

Etapa 9
Adicionar per-monster decision timestamps.

Etapa 10
Adicionar repath jitter controlado.

Etapa 11
Implementar local avoidance.

Etapa 12
Implementar destination slots ao redor de targets.

Etapa 13
Criar Target Scoring.

Etapa 14
Aplicar prioridade Warrior > Archer > Mage.

Etapa 15
Adicionar blocked target handling.

Etapa 16
Integrar ranged positioning.

Etapa 17
Integrar animations.

Etapa 18
Criar debug overlays.

Etapa 19
Testes.

Etapa 20
Benchmark com packs grandes.

==================================================
104. CRITÉRIO FINAL DE ACEITE
==================================================

A movimentação deve deixar de parecer:

“todos os monstros receberam o mesmo comando e deram um passo juntos”.

Cada criatura deve parecer tomar suas próprias decisões.

Mesmo quando 10 monstros perseguem o mesmo Warrior:

- começam movimentos em momentos ligeiramente diferentes;
- podem escolher caminhos próximos diferentes;
- não atravessam uns aos outros;
- não atravessam o player;
- disputam tiles ao redor do alvo;
- contornam obstáculos;
- trocam de alvo quando necessário;
- mantêm movimento visual contínuo.

==================================================
105. RESULTADO VISUAL ESPERADO
==================================================

ERRADO:

M M M M M
↓ ↓ ↓ ↓ ↓
↓ ↓ ↓ ↓ ↓
↓ ↓ ↓ ↓ ↓
     W

Todos perfeitamente sincronizados.

CORRETO:

      M
  M       M
      M
 M         M
      W

Um aproxima pela esquerda.

Outro pela direita.

Outro aguarda espaço.

Outro tenta um tile diferente.

Ranged mantém distância.

A formação surge organicamente do pathfinding e da colisão.

==================================================
106. REGRA FINAL
==================================================

O Avalon Adle continua sendo tile-based.

Mas:

TILE-BASED
NÃO significa
MOVIMENTO ROBÓTICO.

A lógica deve trabalhar em tiles.

A apresentação deve ser contínua.

A IA deve ser independente por entidade.

A colisão deve ser respeitada.

A seleção de alvo deve priorizar:

Warrior
→ Archer
→ Mage

mas sempre considerar:

reachability
blockages
distance
current target
attack type.

Se o alvo prioritário não puder ser alcançado ou atacado, a criatura deve conseguir tomar uma decisão inteligente e atacar outro jogador disponível.

O resultado deve produzir Hunts muito mais naturais, fluidas e vivas, sem o efeito atual de “robôs marchando para batalha”.