import type { AmmoDefinition, ItemDefinition, WeaponDefinition, WeaponType } from '@aetheria/types';

function inferWeaponType(item: ItemDefinition): WeaponType | null {
  const value = `${item.id} ${item.name} ${item.category}`.toLowerCase();
  if (value.includes('staff') || value.includes('wand') || value.includes('rod')) return 'staff';
  if (value.includes('bow') && !value.includes('crossbow')) return 'bow';
  if (value.includes('crossbow')) return 'crossbow';
  if (value.includes('axe')) return 'axe';
  if (value.includes('club')) return 'club';
  if (value.includes('sword')) return 'sword';
  return null;
}

export function getWeaponDefinition(item: ItemDefinition | undefined): WeaponDefinition | null {
  if (!item) return null;
  if (item.weapon) return item.weapon;
  if (item.type !== 'weapon') return null;
  const weaponType = inferWeaponType(item);
  if (!weaponType) return null;
  const magicPower = item.combatStats?.magicPower ?? (weaponType === 'staff' ? item.attack : undefined);
  const attackPower = item.combatStats?.attackPower ?? item.attack;
  return {
    itemId: item.id,
    weaponType,
    attackPower,
    magicPower,
    damageType: weaponType === 'staff' ? 'arcane' : 'physical',
    range: weaponType === 'staff' ? 5 : weaponType === 'bow' ? 6 : weaponType === 'crossbow' ? 7 : 1,
    allowedAmmoType: weaponType === 'bow' ? 'arrow' : weaponType === 'crossbow' ? 'bolt' : undefined,
  };
}

export function getAmmoDefinition(item: ItemDefinition | undefined): AmmoDefinition | null {
  if (!item) return null;
  if (item.ammo) return item.ammo;
  const value = `${item.id} ${item.name} ${item.category}`.toLowerCase();
  const ammoType = value.includes('bolt') ? 'bolt' : value.includes('arrow') ? 'arrow' : null;
  if (!ammoType) return null;
  return {
    itemId: item.id,
    ammoType,
    attackPower: item.combatStats?.attackPower ?? item.attack,
    damageType: 'physical',
  };
}
