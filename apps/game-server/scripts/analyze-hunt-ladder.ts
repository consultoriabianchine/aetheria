import { HUNT_CATALOG, HUNT_CONFIG } from '@aetheria/config';
import { CREATURE_SEED } from '../data/creature-seed';
import { scoreCatalogHunt, suggestedLevelFromScore } from '../src/game/difficulty/combat-power';

const defs = new Map(CREATURE_SEED.map((c) => [c.id, c]));
const getDef = (id: string) => defs.get(id) ?? null;

const pad = (s: string, n: number) => s.padEnd(n);

console.log('=== Ladder de Hunts (modelo de dificuldade) ===');
console.log(
  pad('Pos', 4) +
    pad('Hunt', 22) +
    pad('Score', 9) +
    pad('Nível calc', 12) +
    pad('Nível catálogo', 16) +
    pad('Pack base→max', 15),
);

for (const hunt of [...HUNT_CATALOG].sort((a, b) => a.ladderPosition - b.ladderPosition)) {
  const score = scoreCatalogHunt(hunt, getDef);
  const calcLevel = suggestedLevelFromScore(score, hunt.ladderPosition);
  console.log(
    pad(String(hunt.ladderPosition), 4) +
      pad(hunt.name, 22) +
      pad(score.toFixed(0), 9) +
      pad(String(calcLevel), 12) +
      pad(String(hunt.suggestedLevel), 16) +
      pad(`${hunt.basePackSize}→${hunt.maxPackSize}`, 15),
  );
}

console.log('\n=== Detalhe por hunt ===');
for (const hunt of [...HUNT_CATALOG].sort((a, b) => a.ladderPosition - b.ladderPosition)) {
  const totalWeight = hunt.monsters.reduce((s, m) => s + m.weight, 0) || 1;
  const parts = hunt.monsters
    .map((m) => {
      const def = getDef(m.monsterId);
      const pct = ((m.weight / totalWeight) * 100).toFixed(0);
      return def ? `${def.name} (${pct}%)` : `${m.monsterId} (${pct}%)`;
    })
    .join(', ');
  const boss = getDef(hunt.boss.monsterId);
  const mult = hunt.boss.statMultipliers;
  console.log(
    `${hunt.ladderPosition}. ${hunt.name} — waves ${HUNT_CONFIG.waveCount}, boss wave ${HUNT_CONFIG.bossWave}`,
  );
  console.log(`   Monstros: ${parts}`);
  console.log(
    `   Boss: ${hunt.boss.name} (${boss?.name ?? hunt.boss.monsterId}) HP×${mult.hp} Dmg×${mult.damage} XP×${mult.xp}`,
  );
}