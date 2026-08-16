import type {
  CharacterInventory,
  CharacterSkills,
  CharacterSummary,
  Direction,
  MapTile,
  MonsterState,
  Position,
} from '@aetheria/types';

export type ClientMessage =
  | { type: 'auth.login'; username: string; password: string }
  | { type: 'auth.createCharacter'; token: string; name: string }
  | { type: 'auth.selectCharacter'; token: string; characterId: string }
  | { type: 'game.input'; direction?: Direction | null; attack?: boolean }
  | { type: 'game.move'; direction: Direction }
  | { type: 'game.attack'; targetId: string }
  | { type: 'game.pickup'; entityId: string }
  | { type: 'inventory.equip'; slot: number }
  | { type: 'inventory.unequip'; slot: string }
  | { type: 'chat.send'; channel: string; message: string }
  | { type: 'npc.interact'; npcId: string };

export type ServerMessage =
  | { type: 'auth.loginResult'; ok: boolean; error?: string; token?: string; accountId?: string; characters?: CharacterSummary[] }
  | { type: 'auth.characterCreated'; ok: boolean; error?: string; character?: CharacterSummary }
  | { type: 'auth.selectResult'; ok: boolean; error?: string }
  | { type: 'game.enterWorld'; character: CharacterSummary; map: MapTile[]; width: number; height: number }
  | { type: 'entity.spawned'; id: string; kind: 'player' | 'monster' | 'npc'; name: string; position: Position; health?: number; maxHealth?: number; level?: number }
  | { type: 'entity.moved'; id: string; position: Position }
  | { type: 'entity.removed'; id: string }
  | { type: 'entity.health'; id: string; health: number; maxHealth: number }
  | { type: 'player.moved'; position: Position }
  | { type: 'combat.damage'; attackerId: string; targetId: string; amount: number; critical: boolean; targetHealth: number }
  | { type: 'combat.death'; entityId: string; experience?: number }
  | { type: 'stats.update'; health: number; maxHealth: number; mana: number; maxMana: number; level: number; experience: number; skills: CharacterSkills }
  | { type: 'inventory.update'; inventory: CharacterInventory }
  | { type: 'loot.spawned'; entityId: string; itemId: string; name: string; quantity: number; position: Position }
  | { type: 'loot.removed'; entityId: string }
  | { type: 'chat.message'; channel: string; from: string; text: string }
  | { type: 'npc.dialog'; npcId: string; title: string; lines: string[] }
  | { type: 'error'; message: string };

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
  COMBAT_DAMAGE: 'combat.damage',
  COMBAT_DEATH: 'combat.death',
  STATS_UPDATE: 'stats.update',
  INVENTORY_UPDATE: 'inventory.update',
  LOOT_SPAWNED: 'loot.spawned',
  LOOT_REMOVED: 'loot.removed',
  CHAT_MESSAGE: 'chat.message',
  NPC_DIALOG: 'npc.dialog',
  ERROR: 'error',
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
} as const;

export type { Direction, MonsterState, Position };