import type {
  CharacterInventory,
  CharacterSkills,
  CharacterSummary,
  CharacterEquipment,
  CreatureState,
  Direction,
  HuntListEntry,
  HuntDetails,
  HuntRunView,
  MapTile,
  Position,
  CombatArchetype,
  ItemImpactVisual,
  ItemProjectileVisual,
  PlayerCombatConfig,
  PlayerAppearance,
  DamageType,
  WeaponElementOverride,
  CombatAbilityDefinition,
  AttackRotationSlot,
  HealingRotationSlot,
  AbilityCooldownState,
} from '@aetheria/types';

export type PartyMember = CharacterSummary & { equipment: CharacterEquipment };

export type ClientMessage =
  | { type: 'auth.login'; username: string; password: string }
  | { type: 'auth.createCharacter'; token: string; name: string; archetype: CombatArchetype }
  | { type: 'auth.selectCharacter'; token: string; characterId: string }
  | { type: 'game.input'; direction?: Direction | null; attack?: boolean }
  | { type: 'game.move'; direction: Direction }
  | { type: 'game.attack'; targetId: string }
  | { type: 'game.pickup'; entityId: string }
  | { type: 'inventory.equip'; slot: number; characterId?: string }
  | { type: 'inventory.unequip'; slot: string; characterId?: string }
  | { type: 'inventory.move'; from: 'backpack' | 'loot'; fromIndex: number; to: 'backpack' | 'loot'; toIndex: number }
  | { type: 'inventory.expandLootPouch' }
  | { type: 'inventory.sellLootPouch' }
  | { type: 'chat.send'; channel: string; message: string }
  | { type: 'npc.interact'; npcId: string }
  | { type: 'hunt.list'; token: string }
  | { type: 'hunt.details'; token: string; huntId: string }
  | { type: 'hunt.start'; token: string; huntId: string; loopEnabled: boolean }
  | { type: 'hunt.stop'; token: string }
  | { type: 'hunt.setLoop'; token: string; enabled: boolean }
  | { type: 'hunt.setFavorite'; token: string; huntId: string; favorite: boolean }
  | { type: 'party.unlockSlot'; token: string }
  | { type: 'party.summon'; token: string; characterId: string }
  | { type: 'party.dismiss'; token: string; characterId: string }
  | { type: 'appearance.list'; token: string; characterId?: string }
  | { type: 'appearance.save'; token: string; characterId?: string; outfitId: number; addonMask: number; colors: { head: number; primary: number; secondary: number; detail: number } }
  | { type: 'combat.config'; token: string; characterId?: string; targeting: PlayerCombatConfig['targeting']; movement: PlayerCombatConfig['movement']; attackRange?: number }
  | { type: 'combat.weaponElementOverride.apply'; damageType: DamageType }
  | { type: 'combat.weaponElementOverride.remove' }
  | { type: 'ability.cast'; abilityId: number; targetId?: string; direction?: Direction; position?: Position }
  | { type: 'rotation.attack.set'; preset: string; characterId?: string; slots: AttackRotationSlot[] }
  | { type: 'rotation.healing.set'; preset: string; characterId?: string; slots: HealingRotationSlot[] }
  | { type: 'rotation.load'; preset: string; characterId?: string };

export type ServerMessage =
  | { type: 'auth.loginResult'; ok: boolean; error?: string; token?: string; accountId?: string; characters?: CharacterSummary[] }
  | { type: 'auth.characterCreated'; ok: boolean; error?: string; character?: CharacterSummary }
  | { type: 'auth.selectResult'; ok: boolean; error?: string }
  | { type: 'game.enterWorld'; character: CharacterSummary; map: MapTile[]; width: number; height: number }
  | { type: 'entity.spawned'; id: string; kind: 'player' | 'npc'; name: string; position: Position; health?: number; maxHealth?: number; level?: number; movementSpeed?: number; appearance?: PlayerAppearance }
  | { type: 'entity.moved'; id: string; position: Position; facing?: Direction }
  | { type: 'entity.removed'; id: string }
  | { type: 'entity.health'; id: string; health: number; maxHealth: number }
  | { type: 'player.moved'; position: Position; facing?: Direction }
  | { type: 'creature.spawn'; creatureId: string; definitionId: string; definitionCreatureId?: number; slug: string; name: string; position: Position; facing: Direction; state: CreatureState; health: number; maxHealth: number; level: number; viewRange?: number; chaseRange?: number; attackRange?: number; movementSpeed?: number; description?: string; isBoss?: boolean; footprintWidth?: number; footprintHeight?: number }
  | { type: 'creature.move'; creatureId: string; from: Position; to: Position; facing: Direction; state: CreatureState; timestamp: number; path?: Position[] }
  | { type: 'creature.attack'; creatureId: string; targetId: string; position: Position; facing: Direction; timestamp: number }
  | { type: 'creature.damage'; creatureId: string; attackerId: string; amount: number; critical: boolean; health: number; maxHealth: number }
  | { type: 'creature.death'; creatureId: string; experience: number }
  | { type: 'creature.remove'; creatureId: string }
  | { type: 'combat.projectile'; attackerId: string; targetId: string; from: Position; to: Position; projectile?: ItemProjectileVisual; impact?: ItemImpactVisual; travelTimeMs: number }
  | { type: 'combat.area'; attackerId: string; targetId: string; from: Position; center: Position; tiles: Position[]; projectile?: ItemProjectileVisual; impact?: ItemImpactVisual; travelTimeMs: number }
  | { type: 'combat.damage'; attackerId: string; targetId: string; amount: number; damageType: DamageType; critical: boolean; targetHealth: number; delayMs?: number; criticalImpact?: ItemImpactVisual; position?: Position }
  | { type: 'combat.heal'; sourceId: string; targetId: string; amount: number; critical: boolean; targetHealth: number; resource?: 'hp' | 'mp'; delayMs?: number }
  | { type: 'combat.death'; entityId: string; experience?: number }
  | { type: 'xp.gained'; amount: number; characterId?: string }
  | { type: 'gold.gained'; amount: number; position?: Position }
  | { type: 'stats.update'; health: number; maxHealth: number; mana: number; maxMana: number; level: number; experience: number; skills: CharacterSkills; speed?: number; movementSpeed?: number; skillProgress?: { skillType: keyof CharacterSkills; level: number; experience: number }[] }
  | { type: 'stats.combat'; characterId: string; armor: number; defense: number; criticalChance: number; criticalDamage: number; accuracy: number; dodge: number; speed: number; resistances: Record<DamageType, number>; damageBonuses: Record<DamageType, number> }
  | { type: 'skills.update'; skills: CharacterSkills }
  | { type: 'inventory.update'; inventory: CharacterInventory }
  | { type: 'loot.spawned'; entityId: string; itemId: string; name: string; quantity: number; position: Position }
  | { type: 'loot.removed'; entityId: string }
  | { type: 'chat.message'; channel: string; from: string; text: string }
  | { type: 'npc.dialog'; npcId: string; title: string; lines: string[] }
  | { type: 'error'; message: string }
  | { type: 'hunt.list'; hunts: HuntListEntry[] }
  | { type: 'hunt.details'; details: HuntDetails }
  | { type: 'hunt.started'; hunt: HuntRunView }
  | { type: 'game.enterArena'; character: CharacterSummary; members: CharacterSummary[]; map: MapTile[]; width: number; height: number; hunt: HuntRunView }
  | { type: 'hunt.wave'; huntId: string; wave: number; monsterCount: number; isBoss: boolean }
  | { type: 'hunt.cleared'; huntId: string; wave: number }
  | { type: 'hunt.completed'; huntId: string; completionCount: number; clearTimeMs: number; bestClearTimeMs: number | null; loopEnabled: boolean }
  | { type: 'hunt.wiped'; huntId: string; penaltyPaid: number; loopEnabled: boolean; respawnInMs: number | null }
  | { type: 'hunt.loopChanged'; huntId: string; loopEnabled: boolean }
  | { type: 'hunt.favoriteChanged'; huntId: string; favorite: boolean }
  | { type: 'hunt.returnedToCity' }
  | { type: 'party.state'; unlockedSlots: number; maxSlots: number; unlockCost: number | null; members: PartyMember[] }
  | { type: 'gold.update'; gold: number }
  | { type: 'appearance.list'; outfits: { outfitId: number; name: string; slug: string; category: string; supportsColors: boolean; supportsAddons: boolean }[] }
  | { type: 'appearance.changed'; entityId: string; outfitId: number; addonMask: number; colors: { head: number; primary: number; secondary: number; detail: number } }
  | { type: 'combat.config'; characterId: string; combat: PlayerCombatConfig }
  | { type: 'combat.weaponElementOverride.applied'; override: WeaponElementOverride }
  | { type: 'combat.weaponElementOverride.removed'; reason: 'manual' | 'expired' }
  | { type: 'abilities.update'; abilities: CombatAbilityDefinition[] }
  | { type: 'rotation.state'; preset: string; characterId?: string; attack: AttackRotationSlot[]; healing: HealingRotationSlot[]; cooldowns: AbilityCooldownState }
  | { type: 'cooldowns.update'; characterId: string; attackGroupReadyAt: number; healingGroupReadyAt: number; abilityReadyAt: Record<number, number> }
  | { type: 'ability.castFailed'; abilityId: number; reason: string }
  | { type: 'ability.cast'; abilityId: number; attackerId: string; targetId?: string };

export interface WsEnvelope {
  event: string;
  data: unknown;
}

export function clientEvent(msg: ClientMessage): string {
  return msg.type;
}

export type ClientEvent = ClientMessage['type'];
export type ServerEvent = ServerMessage['type'];

export const SERVER_EVENTS = {
  LOGIN_RESULT: 'auth.loginResult',
  CHARACTER_CREATED: 'auth.characterCreated',
  SELECT_RESULT: 'auth.selectResult',
  ENTER_WORLD: 'game.enterWorld',
  ENTITY_SPAWNED: 'entity.spawned',
  ENTITY_MOVED: 'entity.moved',
  ENTITY_REMOVED: 'entity.removed',
  ENTITY_HEALTH: 'entity.health',
  PLAYER_MOVED: 'player.moved',
  CREATURE_SPAWN: 'creature.spawn',
  CREATURE_MOVE: 'creature.move',
  CREATURE_ATTACK: 'creature.attack',
  CREATURE_DAMAGE: 'creature.damage',
  CREATURE_DEATH: 'creature.death',
  CREATURE_REMOVE: 'creature.remove',
  COMBAT_DAMAGE: 'combat.damage',
  COMBAT_HEAL: 'combat.heal',
  COMBAT_PROJECTILE: 'combat.projectile',
  COMBAT_AREA: 'combat.area',
  COMBAT_DEATH: 'combat.death',
  XP_GAINED: 'xp.gained',
  GOLD_GAINED: 'gold.gained',
  STATS_UPDATE: 'stats.update',
  STATS_COMBAT: 'stats.combat',
  SKILLS_UPDATE: 'skills.update',
  INVENTORY_UPDATE: 'inventory.update',
  LOOT_SPAWNED: 'loot.spawned',
  LOOT_REMOVED: 'loot.removed',
  CHAT_MESSAGE: 'chat.message',
  NPC_DIALOG: 'npc.dialog',
  ERROR: 'error',
  HUNT_LIST: 'hunt.list',
  HUNT_DETAILS: 'hunt.details',
  HUNT_STARTED: 'hunt.started',
  ENTER_ARENA: 'game.enterArena',
  HUNT_WAVE: 'hunt.wave',
  HUNT_CLEARED: 'hunt.cleared',
  HUNT_COMPLETED: 'hunt.completed',
  HUNT_WIPED: 'hunt.wiped',
  HUNT_LOOP_CHANGED: 'hunt.loopChanged',
  HUNT_FAVORITE_CHANGED: 'hunt.favoriteChanged',
  HUNT_RETURNED_TO_CITY: 'hunt.returnedToCity',
  PARTY_STATE: 'party.state',
  CHARACTERS_UPDATE: 'characters.update',
  GOLD_UPDATE: 'gold.update',
  APPEARANCE_LIST: 'appearance.list',
  APPEARANCE_CHANGED: 'appearance.changed',
  COMBAT_CONFIG: 'combat.config',
  COOLDOWNS_UPDATE: 'cooldowns.update',
  WEAPON_ELEMENT_OVERRIDE_APPLIED: 'combat.weaponElementOverride.applied',
  WEAPON_ELEMENT_OVERRIDE_REMOVED: 'combat.weaponElementOverride.removed',
} as const;

export const CLIENT_EVENTS = {
  LOGIN: 'auth.login',
  CREATE_CHARACTER: 'auth.createCharacter',
  SELECT_CHARACTER: 'auth.selectCharacter',
  INPUT: 'game.input',
  MOVE: 'game.move',
  ATTACK: 'game.attack',
  PICKUP: 'game.pickup',
  EQUIP: 'inventory.equip',
  UNEQUIP: 'inventory.unequip',
  EXPAND_LOOT_POUCH: 'inventory.expandLootPouch',
  SELL_LOOT_POUCH: 'inventory.sellLootPouch',
  CHAT: 'chat.send',
  NPC_INTERACT: 'npc.interact',
  HUNT_LIST: 'hunt.list',
  HUNT_START: 'hunt.start',
  HUNT_STOP: 'hunt.stop',
  HUNT_SET_LOOP: 'hunt.setLoop',
  HUNT_SET_FAVORITE: 'hunt.setFavorite',
  PARTY_UNLOCK_SLOT: 'party.unlockSlot',
  PARTY_SUMMON: 'party.summon',
  PARTY_DISMISS: 'party.dismiss',
  APPEARANCE_LIST: 'appearance.list',
  APPEARANCE_SAVE: 'appearance.save',
  COMBAT_CONFIG: 'combat.config',
  WEAPON_ELEMENT_OVERRIDE_APPLIED: 'combat.weaponElementOverride.applied',
  WEAPON_ELEMENT_OVERRIDE_REMOVED: 'combat.weaponElementOverride.removed',
} as const;

export type { CreatureState, Direction, Position };
