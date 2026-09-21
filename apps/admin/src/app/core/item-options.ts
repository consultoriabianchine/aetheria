import type { AmmoType, DamageType, EquipmentSlot, ItemType, WeaponType } from '@aetheria/types';

export const ITEM_TYPES: ItemType[] = ['helmet', 'armor', 'legs', 'boots', 'weapon', 'ring', 'necklace', 'relic', 'offhand', 'ammo', 'consumable', 'loot', 'other'];
export const ITEM_SLOTS: EquipmentSlot[] = ['helmet', 'armor', 'legs', 'boots', 'ring', 'necklace', 'relic', 'weapon', 'offhand', 'ammo'];
export const WEAPON_TYPES: WeaponType[] = ['staff', 'sword', 'axe', 'club', 'bow', 'crossbow'];
export const AMMO_TYPES: AmmoType[] = ['arrow', 'bolt'];
export const DAMAGE_TYPES: DamageType[] = ['physical', 'fire', 'ice', 'energy', 'earth', 'holy', 'death', 'arcane'];
