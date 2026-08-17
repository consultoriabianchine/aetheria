import { describe, expect, it } from 'vitest';
import { GAME_CONFIG, VOCATIONS } from '@aetheria/config';
import { calculateMaxHp, calculateMaxMana, applyVocationDamageReduction, computeCoreStats } from '../src/game/stats/stat-engine';
import { calculateRegeneration } from '../src/game/regeneration/regeneration-engine';
import { trainSkill, skillXpForLevel } from '../src/game/skills/skill-engine';
import { validatePromotion, applyPromotion } from '../src/game/vocations/promotion.service';
import { MemoryStore } from '../src/game/store/memory-store';
import type { CharacterSkills, StoredCharacter, VocationId } from '@aetheria/types';

function makeCharacter(overrides: Partial<StoredCharacter> = {}): StoredCharacter {
  return {
    id: 'c1',
    accountId: 'a1',
    name: 'Hero',
    vocation: 'knight',
    promoted: false,
    promotedAt: null,
    gold: 0,
    level: 1,
    experience: 0,
    health: 115,
    maxHealth: 115,
    mana: 55,
    maxMana: 55,
    position: { x: 32, y: 32, z: 7 },
    skills: { sword: 10, axe: 10, club: 10, distance: 10, magic: 10, shielding: 10 },
    inventory: new Array(24).fill(null),
    equipment: {},
    ...overrides,
  };
}

describe('StatEngine — HP', () => {
  it.each([
    ['knight', 1600],
    ['paladin', 1100],
    ['sorcerer', 600],
    ['druid', 600],
  ] as const)('Lv100 %s = %i HP', (vocation, expected) => {
    expect(calculateMaxHp(100, VOCATIONS[vocation])).toBe(expected);
  });
});

describe('StatEngine — Mana', () => {
  it.each([
    ['knight', 550],
    ['paladin', 1550],
    ['sorcerer', 3050],
    ['druid', 3050],
  ] as const)('Lv100 %s = %i Mana', (vocation, expected) => {
    expect(calculateMaxMana(100, VOCATIONS[vocation])).toBe(expected);
  });
});

describe('StatEngine — Lv1', () => {
  it('Knight Lv1 = 115 HP / 55 Mana', () => {
    expect(calculateMaxHp(1, VOCATIONS.knight)).toBe(115);
    expect(calculateMaxMana(1, VOCATIONS.knight)).toBe(55);
  });
});

describe('StatEngine — Damage Reduction', () => {
  it.each([
    ['knight', 900],
    ['paladin', 1000],
    ['sorcerer', 1000],
    ['druid', 900],
  ] as const)('%s: 1000 dano → %i', (vocation, expected) => {
    expect(applyVocationDamageReduction(1000, VOCATIONS[vocation])).toBe(expected);
  });

  it('nunca reduz abaixo de 1', () => {
    expect(applyVocationDamageReduction(1, VOCATIONS.knight)).toBe(1);
  });
});

describe('StatEngine — Core stats', () => {
  it('promovido multiplica regeneração por 1.5', () => {
    const base = computeCoreStats(50, 'knight', false);
    const promoted = computeCoreStats(50, 'knight', true);
    expect(promoted.hpRegeneration).toBeCloseTo(base.hpRegeneration * 1.5);
    expect(promoted.manaRegeneration).toBeCloseTo(base.manaRegeneration * 1.5);
  });
});

describe('RegenerationEngine', () => {
  it('recupera HP/Mana por tempo decorrido sem estourar o máximo', () => {
    const res = calculateRegeneration(30, {
      vocationId: 'knight',
      promoted: false,
      currentHp: 50,
      currentMana: 10,
      maxHp: 200,
      maxMana: 100,
    });
    expect(res.finalHp).toBeLessThanOrEqual(200);
    expect(res.finalMana).toBeLessThanOrEqual(100);
    expect(res.hpRecovered).toBeGreaterThan(0);
  });

  it('promovido regenera 1.5x mais', () => {
    const normal = calculateRegeneration(60, {
      vocationId: 'druid',
      promoted: false,
      currentHp: 0,
      currentMana: 0,
      maxHp: 1000,
      maxMana: 1000,
    });
    const promoted = calculateRegeneration(60, {
      vocationId: 'druid',
      promoted: true,
      currentHp: 0,
      currentMana: 0,
      maxHp: 1000,
      maxMana: 1000,
    });
    expect(promoted.hpRecovered).toBe(Math.floor(normal.hpRecovered * 1.5));
    expect(promoted.manaRecovered).toBe(Math.floor(normal.manaRecovered * 1.5));
  });
});

describe('SkillEngine', () => {
  const baseSkills: CharacterSkills = { sword: 10, axe: 10, club: 10, distance: 10, magic: 10, shielding: 10 };

  it('Knight treina melee mais rápido que Sorcerer', () => {
    const knight = trainSkill(baseSkills, [], 'axe', 'knight', 1000);
    const sorcerer = trainSkill(baseSkills, [], 'axe', 'sorcerer', 1000);
    expect(knight.skills.axe).toBeGreaterThan(sorcerer.skills.axe);
  });

  it('Sorcerer treina magic mais rápido que Knight', () => {
    const sorcerer = trainSkill(baseSkills, [], 'magic', 'sorcerer', 1000);
    const knight = trainSkill(baseSkills, [], 'magic', 'knight', 1000);
    expect(sorcerer.skills.magic).toBeGreaterThan(knight.skills.magic);
  });

  it('Paladin treina distance mais rápido que Knight', () => {
    const paladin = trainSkill(baseSkills, [], 'distance', 'paladin', 1000);
    const knight = trainSkill(baseSkills, [], 'distance', 'knight', 1000);
    expect(paladin.skills.distance).toBeGreaterThan(knight.skills.distance);
  });

  it('dispara SKILL_LEVEL_UP ao acumular XP suficiente', () => {
    const result = trainSkill(baseSkills, [], 'sword', 'knight', skillXpForLevel(10) * 2);
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    expect(result.events[0].skill).toBe('sword');
    expect(result.skills.sword).toBeGreaterThan(10);
  });
});

describe('PromotionService', () => {
  it('Lv19 + 1.000.000 gold → rejeitado', () => {
    const c = makeCharacter({ level: 19, gold: 1_000_000 });
    expect(validatePromotion(c)).toBe('PROMOTION_LEVEL_REQUIRED');
  });

  it('Lv20 + 19.999 gold → rejeitado', () => {
    const c = makeCharacter({ level: 20, gold: 19_999 });
    expect(validatePromotion(c)).toBe('PROMOTION_NOT_ENOUGH_GOLD');
  });

  it('Lv20 + 20.000 gold → promovido e deduz exatamente 20.000', () => {
    const c = makeCharacter({ level: 20, gold: 20_000 });
    expect(validatePromotion(c)).toBeNull();
    const promoted = applyPromotion(c);
    expect(promoted.promoted).toBe(true);
    expect(promoted.gold).toBe(0);
  });

  it('já promovido → rejeitado', () => {
    const c = makeCharacter({ level: 20, gold: 20_000, promoted: true });
    expect(validatePromotion(c)).toBe('ALREADY_PROMOTED');
  });

  it('personagem inexistente → CHARACTER_NOT_FOUND', () => {
    expect(validatePromotion(null)).toBe('CHARACTER_NOT_FOUND');
  });
});

describe('MemoryStore.promoteCharacter', () => {
  it('valida ownership e persiste a promoção', async () => {
    const store = new MemoryStore();
    await store.createAccount('player', 'hash');
    const created = await store.createCharacter('a1', {
      name: 'Hero',
      vocation: 'knight',
      promoted: false,
      promotedAt: null,
      gold: 25_000,
      level: 20,
      experience: 0,
      health: 115,
      maxHealth: 115,
      mana: 55,
      maxMana: 55,
      position: { x: 32, y: 32, z: 7 },
      skills: { sword: 10, axe: 10, club: 10, distance: 10, magic: 10, shielding: 10 },
      inventory: new Array(24).fill(null),
      equipment: {},
    });

    const notOwned = await store.promoteCharacter('someone-else', created.id);
    expect(notOwned.ok).toBe(false);

    const result = await store.promoteCharacter('a1', created.id);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.character.promoted).toBe(true);
      expect(result.character.gold).toBe(5_000);
      expect(GAME_CONFIG.promotion.goldCost).toBe(20_000);
    }

    const again = await store.promoteCharacter('a1', created.id);
    expect(again.ok).toBe(false);
  });
});

describe('Vocations config', () => {
  it('todas as vocações têm os campos essenciais', () => {
    for (const id of ['knight', 'paladin', 'sorcerer', 'druid'] as VocationId[]) {
      const v = VOCATIONS[id];
      expect(v.primarySkill).toBeDefined();
      expect(v.initialWeapon).toBeTruthy();
      expect(v.trainingRates).toBeDefined();
      expect(v.promotion.goldCost).toBe(20_000);
    }
  });

  it('Knight pode usar shield; demais não', () => {
    expect(VOCATIONS.knight.canUseShield).toBe(true);
    expect(VOCATIONS.paladin.canUseShield).toBe(false);
    expect(VOCATIONS.sorcerer.canUseShield).toBe(false);
    expect(VOCATIONS.druid.canUseShield).toBe(false);
  });
});