import type {
  CharacterInventory,
  CharacterSkills,
  CharacterSummary,
  CreatureState,
  Direction,
  HuntListEntry,
  HuntRunView,
  MapTile,
  Position,
  CombatArchetype,
  ItemImpactVisual,
  ItemProjectileVisual,
} from '@aetheria/types';

export type ClientMessage =
  | { type: 'auth.login'; username: string; password: string }
  | { type: 'auth.createCharacter'; token: string; name: string; archetype: CombatArchetype }
  | { type: 'auth.selectCharacter'; token: string; characterId: string }
  | { type: 'game.input'; direction?: Direction | null; attack?: boolean }
  | { type: 'game.move'; direction: Direction }
  | { type: 'game.attack'; targetId: string }
  | { type: 'game.pickup'; entityId: string }
  | { type: 'inventory.equip'; slot: number }
  | { type: 'inventory.unequip'; slot: string }
  | { type: 'chat.send'; channel: string; message: string }
  | { type: 'npc.interact'; npcId: string }
  | { type: 'hunt.list'; token: string }
  | { type: 'hunt.start'; token: string; huntId: string; loopEnabled: boolean }
  | { type: 'hunt.stop'; token: string }
  | { type: 'hunt.setLoop'; token: string; enabled: boolean }
  | { type: 'appearance.list'; token: string }
  | { type: 'appearance.save'; token: string; outfitId: number; addonMask: number; colors: { head: number; primary: number; secondary: number; detail: number } };

export type ServerMessage =
  | { type: 'auth.loginResult'; ok: boolean; error?: string; token?: string; accountId?: string; characters?: CharacterSummary[] }
  | { type: 'auth.characterCreated'; ok: boolean; error?: string; character?: CharacterSummary }
  | { type: 'auth.selectResult'; ok: boolean; error?: string }
  | { type: 'game.enterWorld'; character: CharacterSummary; map: MapTile[]; width: number; height: number }
  | { type: 'entity.spawned'; id: string; kind: 'player' | 'npc'; name: string; position: Position; health?: number; maxHealth?: number; level?: number }
  | { type: 'entity.moved'; id: string; position: Position }
  | { type: 'entity.removed'; id: string }
  | { type: 'entity.health'; id: string; health: number; maxHealth: number }
  | { type: 'player.moved'; position: Position }
  | { type: 'creature.spawn'; creatureId: string; definitionId: string; definitionCreatureId?: number; slug: string; name: string; position: Position; facing: Direction; state: CreatureState; health: number; maxHealth: number; level: number; viewRange?: number; chaseRange?: number; attackRange?: number; movementSpeed?: number; description?: string; isBoss?: boolean }
  | { type: 'creature.move'; creatureId: string; from: Position; to: Position; facing: Direction; state: CreatureState; timestamp: number; path?: Position[] }
  | { type: 'creature.attack'; creatureId: string; targetId: string; position: Position; timestamp: number }
  | { type: 'creature.damage'; creatureId: string; attackerId: string; amount: number; critical: boolean; health: number; maxHealth: number }
  | { type: 'creature.death'; creatureId: string; experience: number }
  | { type: 'creature.remove'; creatureId: string }
  | { type: 'combat.projectile'; attackerId: string; targetId: string; from: Position; to: Position; projectile: ItemProjectileVisual; impact?: ItemImpactVisual; travelTimeMs: number }
  | { type: 'combat.damage'; attackerId: string; targetId: string; amount: number; critical: boolean; targetHealth: number; delayMs?: number }
  | { type: 'combat.death'; entityId: string; experience?: number }
  | { type: 'stats.update'; health: number; maxHealth: number; mana: number; maxMana: number; level: number; experience: number; skills: CharacterSkills; skillProgress?: { skillType: keyof CharacterSkills; level: number; experience: number }[] }
  | { type: 'skills.update'; skills: CharacterSkills }
  | { type: 'inventory.update'; inventory: CharacterInventory }
  | { type: 'loot.spawned'; entityId: string; itemId: string; name: string; quantity: number; position: Position }
  | { type: 'loot.removed'; entityId: string }
  | { type: 'chat.message'; channel: string; from: string; text: string }
  | { type: 'npc.dialog'; npcId: string; title: string; lines: string[] }
  | { type: 'error'; message: string }
  | { type: 'hunt.list'; hunts: HuntListEntry[] }
  | { type: 'hunt.started'; hunt: HuntRunView }
  | { type: 'game.enterArena'; character: CharacterSummary; map: MapTile[]; width: number; height: number; hunt: HuntRunView }
  | { type: 'hunt.wave'; huntId: string; wave: number; monsterCount: number; isBoss: boolean }
  | { type: 'hunt.cleared'; huntId: string; wave: number }
  | { type: 'hunt.completed'; huntId: string; completionCount: number; clearTimeMs: number; bestClearTimeMs: number | null; loopEnabled: boolean }
  | { type: 'hunt.wiped'; huntId: string; penaltyPaid: number; loopEnabled: boolean; respawnInMs: number | null }
  | { type: 'hunt.loopChanged'; huntId: string; loopEnabled: boolean }
  | { type: 'hunt.returnedToCity' }
  | { type: 'gold.update'; gold: number }
  | { type: 'appearance.list'; outfits: { outfitId: number; name: string; slug: string; category: string; supportsColors: boolean; supportsAddons: boolean }[] }
  | { type: 'appearance.changed'; entityId: string; outfitId: number; addonMask: number; colors: { head: number; primary: number; secondary: number; detail: number } };

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
  COMBAT_PROJECTILE: 'combat.projectile',
  COMBAT_DEATH: 'combat.death',
  STATS_UPDATE: 'stats.update',
  SKILLS_UPDATE: 'skills.update',
  INVENTORY_UPDATE: 'inventory.update',
  LOOT_SPAWNED: 'loot.spawned',
  LOOT_REMOVED: 'loot.removed',
  CHAT_MESSAGE: 'chat.message',
  NPC_DIALOG: 'npc.dialog',
  ERROR: 'error',
  HUNT_LIST: 'hunt.list',
  HUNT_STARTED: 'hunt.started',
  ENTER_ARENA: 'game.enterArena',
  HUNT_WAVE: 'hunt.wave',
  HUNT_CLEARED: 'hunt.cleared',
  HUNT_COMPLETED: 'hunt.completed',
  HUNT_WIPED: 'hunt.wiped',
  HUNT_LOOP_CHANGED: 'hunt.loopChanged',
  HUNT_RETURNED_TO_CITY: 'hunt.returnedToCity',
  GOLD_UPDATE: 'gold.update',
  APPEARANCE_LIST: 'appearance.list',
  APPEARANCE_CHANGED: 'appearance.changed',
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
  CHAT: 'chat.send',
  NPC_INTERACT: 'npc.interact',
  HUNT_LIST: 'hunt.list',
  HUNT_START: 'hunt.start',
  HUNT_STOP: 'hunt.stop',
  HUNT_SET_LOOP: 'hunt.setLoop',
  APPEARANCE_LIST: 'appearance.list',
  APPEARANCE_SAVE: 'appearance.save',
} as const;

export type { CreatureState, Direction, Position };
