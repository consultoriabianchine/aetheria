import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { CombatArchetype, DamageType } from '@aetheria/types';
import { AdminAuthGuard } from './admin-auth.guard';
import { calculateBasicAttack } from '../combat/basic-attack-calculator';
import { emptyResistances } from '../combat/character-stat-aggregator';
import { calculateMitigatedDamage } from '../combat/damage-calculator';

interface FormulaTestInput {
  archetype: CombatArchetype;
  level: number;
  melee: number;
  distance: number;
  magic: number;
  weaponPower: number;
  staffPower: number;
  ammoPower: number;
  targetLevel: number;
  armor: number;
  defense: number;
  damageType: DamageType;
  resistance: number;
  critical: boolean;
  abilityMultiplier: number;
  flatPower: number;
}

@Controller('admin/combat')
@UseGuards(AdminAuthGuard)
export class CombatAdminController {
  @Post('formula-test')
  formulaTest(@Body() body: FormulaTestInput) {
    const attacker = {
      level: number(body.level, 1),
      maxHp: 100,
      maxMana: 50,
      armor: 0,
      defense: 0,
      meleeSkill: number(body.melee, 10),
      distanceSkill: number(body.distance, 10),
      magicLevel: number(body.magic, 10),
      criticalChance: body.critical ? 1 : 0,
      criticalDamage: 1.5,
      accuracy: 0,
      dodge: 0,
      resistances: emptyResistances(),
    };
    const targetResistances = emptyResistances();
    targetResistances[body.damageType ?? 'physical'] = number(body.resistance, 0);
    const target = {
      level: number(body.targetLevel, 1),
      maxHp: 100,
      maxMana: 0,
      armor: number(body.armor, 0),
      defense: number(body.defense, 0),
      meleeSkill: 0,
      distanceSkill: 0,
      magicLevel: 0,
      criticalChance: 0,
      criticalDamage: 1.5,
      accuracy: 0,
      dodge: 0,
      resistances: targetResistances,
    };
    const weapon = weaponFor(body);
    const ammo = body.archetype === 'archer' ? { itemId: 'ammo', ammoType: weapon.allowedAmmoType ?? 'arrow', attackPower: number(body.ammoPower, 0), damageType: body.damageType ?? 'physical' } as const : null;
    const averageAttack = calculateBasicAttack({
      archetype: body.archetype,
      attacker,
      loadout: { weapon, ammo },
      abilityMultiplier: number(body.abilityMultiplier, 1),
      flatPower: number(body.flatPower, 0),
      rng: () => 0.5,
    });
    if (!averageAttack.valid) return { ok: false, reason: averageAttack.reason };
    const minAttack = calculateBasicAttack({ ...{ archetype: body.archetype, attacker, loadout: { weapon, ammo }, abilityMultiplier: number(body.abilityMultiplier, 1), flatPower: number(body.flatPower, 0) }, rng: () => 0 });
    const maxAttack = calculateBasicAttack({ ...{ archetype: body.archetype, attacker, loadout: { weapon, ammo }, abilityMultiplier: number(body.abilityMultiplier, 1), flatPower: number(body.flatPower, 0) }, rng: () => 0.999 });
    const normal = calculateMitigatedDamage({ damage: averageAttack.damageBeforeMitigation, damageType: averageAttack.damageType, target });
    const min = calculateMitigatedDamage({ damage: minAttack.damageBeforeMitigation, damageType: minAttack.damageType, target });
    const max = calculateMitigatedDamage({ damage: maxAttack.damageBeforeMitigation, damageType: maxAttack.damageType, target });
    const crit = calculateMitigatedDamage({ damage: averageAttack.rawDamage * attacker.criticalDamage, damageType: averageAttack.damageType, target });
    return {
      ok: true,
      basePower: averageAttack.basePower,
      skill: averageAttack.scalingSkill,
      skillLevel: averageAttack.skillLevel,
      damageType: averageAttack.damageType,
      rawDamage: averageAttack.rawDamage,
      mitigation: normal.mitigation,
      normalDamage: normal.finalDamage,
      criticalDamage: crit.finalDamage,
      min: min.finalDamage,
      average: normal.finalDamage,
      max: max.finalDamage,
    };
  }
}

function number(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function weaponFor(body: FormulaTestInput) {
  if (body.archetype === 'mage') {
    return { itemId: 'staff', weaponType: 'staff' as const, attackPower: 0, magicPower: number(body.staffPower, 0), damageType: body.damageType ?? 'arcane', range: 5 };
  }
  if (body.archetype === 'archer') {
    return { itemId: 'bow', weaponType: 'bow' as const, attackPower: number(body.weaponPower, 0), damageType: 'physical' as const, range: 6, allowedAmmoType: 'arrow' as const };
  }
  return { itemId: 'weapon', weaponType: 'sword' as const, attackPower: number(body.weaponPower, 0), damageType: 'physical' as const, range: 1 };
}
