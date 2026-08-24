import type { DamageType, WeaponDefinition, WeaponElementOverride } from '@aetheria/types';

export function resolveEffectiveWeaponDamageType(input: {
  weapon: WeaponDefinition;
  ammoDamageType?: DamageType;
  override?: WeaponElementOverride;
  now: number;
}): DamageType {
  if (input.override && input.now < input.override.expiresAt) return input.override.damageType;
  if (input.ammoDamageType && input.ammoDamageType !== 'physical') return input.ammoDamageType;
  return input.weapon.damageType ?? 'physical';
}
