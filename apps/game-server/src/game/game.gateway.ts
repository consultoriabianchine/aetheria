import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameEngine } from './engine/game-engine';

@WebSocketGateway({ cors: { origin: true }, transports: ['websocket', 'polling'] })
export class GameGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly engine: GameEngine) {}

  afterInit() {
    this.engine.setEmitFn((socketId, event, data) => {
      const socket = this.server.sockets.sockets.get(socketId);
      if (socket) socket.emit(event, data);
    });
    this.engine.start();
  }

  handleConnection(_socket: Socket) {
    // Conexão estabelecida — aguarda auth.
  }

  handleDisconnect(socket: Socket) {
    this.engine.handleDisconnect(socket.id);
  }

  @SubscribeMessage('auth.login')
  async onLogin(socket: Socket, payload: { username: string; password: string }) {
    await this.engine.handleLogin(socket.id, payload.username, payload.password);
  }

  @SubscribeMessage('auth.createCharacter')
  async onCreateCharacter(socket: Socket, payload: { token: string; name: string; archetype: string }) {
    await this.engine.handleCreateCharacter(socket.id, payload.token, payload.name, payload.archetype as never);
  }

  @SubscribeMessage('auth.selectCharacter')
  async onSelectCharacter(socket: Socket, payload: { token: string; characterId: string }) {
    await this.engine.handleSelectCharacter(socket.id, payload.token, payload.characterId);
  }

  @SubscribeMessage('game.input')
  onInput(socket: Socket, payload: { direction?: string | null }) {
    this.engine.handleInput(socket.id, (payload.direction as never) ?? null);
  }

  @SubscribeMessage('ability.cast')
  onAbilityCast(socket: Socket, payload: { abilityId: number; targetId?: string; direction?: string; position?: { x: number; y: number; z: number } }) {
    void this.engine.handleAbilityCast(socket.id, payload.abilityId, payload.targetId, (payload.direction as never) ?? undefined, payload.position);
  }

  @SubscribeMessage('rotation.load')
  onRotationLoad(socket: Socket, payload: { preset: string; characterId?: string }) { void this.engine.handleRotationLoad(socket.id, payload.preset, payload.characterId); }

  @SubscribeMessage('rotation.attack.set')
  onAttackRotation(socket: Socket, payload: { preset: string; characterId?: string; slots: { position: 1 | 2 | 3 | 4; abilityId?: number; enabled: boolean; minTargets?: number }[] }) { this.engine.handleAttackRotation(socket.id, payload.preset, payload.slots, payload.characterId); }

  @SubscribeMessage('rotation.healing.set')
  onHealingRotation(socket: Socket, payload: { preset: string; characterId?: string; slots: { position: 1 | 2 | 3 | 4; abilityId?: number; enabled: boolean; trigger: { target: 'self' | 'lowest_party_member' | 'specific_party_role'; hpBelowPercent: number } }[] }) { this.engine.handleHealingRotation(socket.id, payload.preset, payload.slots, payload.characterId); }

  @SubscribeMessage('game.attack')
  onAttack(socket: Socket, payload: { targetId: string }) {
    this.engine.handleAttack(socket.id, payload.targetId);
  }

  @SubscribeMessage('game.pickup')
  onPickup(socket: Socket, payload: { entityId: string }) {
    void this.engine.handlePickup(socket.id, payload.entityId);
  }

  @SubscribeMessage('inventory.equip')
  onEquip(socket: Socket, payload: { slot: number; characterId?: string }) {
    void this.engine.handleEquip(socket.id, payload.slot, payload.characterId);
  }

  @SubscribeMessage('inventory.unequip')
  onUnequip(socket: Socket, payload: { slot: string; characterId?: string }) {
    void this.engine.handleUnequip(socket.id, payload.slot, payload.characterId);
  }

  @SubscribeMessage('inventory.move')
  onInventoryMove(socket: Socket, payload: { from: 'backpack' | 'loot'; fromIndex: number; to: 'backpack' | 'loot'; toIndex: number }) {
    void this.engine.handleInventoryMove(socket.id, payload.from, payload.fromIndex, payload.to, payload.toIndex);
  }

  @SubscribeMessage('inventory.expandLootPouch')
  onExpandLootPouch(socket: Socket) {
    this.engine.handleExpandLootPouch(socket.id);
  }

  @SubscribeMessage('inventory.sellLootPouch')
  onSellLootPouch(socket: Socket) {
    this.engine.handleSellLootPouch(socket.id);
  }

  @SubscribeMessage('chat.send')
  onChat(socket: Socket, payload: { channel: string; message: string }) {
    this.engine.handleChat(socket.id, payload.channel, payload.message);
  }

  @SubscribeMessage('npc.interact')
  onNpcInteract(socket: Socket, payload: { npcId: string }) {
    this.engine.handleNpcInteract(socket.id, payload.npcId);
  }

  @SubscribeMessage('hunt.list')
  async onHuntList(socket: Socket, payload: { token: string }) {
    await this.engine.handleHuntList(socket.id, payload.token);
  }

  @SubscribeMessage('hunt.start')
  async onHuntStart(socket: Socket, payload: { token: string; huntId: string; loopEnabled: boolean }) {
    await this.engine.handleHuntStart(socket.id, payload.token, payload.huntId, payload.loopEnabled);
  }

  @SubscribeMessage('hunt.stop')
  async onHuntStop(socket: Socket, payload: { token: string }) {
    await this.engine.handleHuntStop(socket.id, payload.token);
  }

  @SubscribeMessage('hunt.setLoop')
  async onHuntSetLoop(socket: Socket, payload: { token: string; enabled: boolean }) {
    await this.engine.handleHuntSetLoop(socket.id, payload.token, payload.enabled);
  }

  @SubscribeMessage('party.unlockSlot')
  async onPartyUnlockSlot(socket: Socket, payload: { token: string }) {
    await this.engine.handlePartyUnlockSlot(socket.id, payload.token);
  }

  @SubscribeMessage('party.summon')
  async onPartySummon(socket: Socket, payload: { token: string; characterId: string }) {
    await this.engine.handlePartySummon(socket.id, payload.token, payload.characterId);
  }

  @SubscribeMessage('party.dismiss')
  async onPartyDismiss(socket: Socket, payload: { token: string; characterId: string }) {
    await this.engine.handlePartyDismiss(socket.id, payload.token, payload.characterId);
  }

  @SubscribeMessage('appearance.list')
  async onAppearanceList(socket: Socket, payload: { token: string; characterId?: string }) {
    await this.engine.handleAppearanceList(socket.id, payload.token, payload.characterId);
  }

  @SubscribeMessage('appearance.save')
  async onAppearanceSave(socket: Socket, payload: { token: string; characterId?: string; outfitId: number; addonMask: number; colors: { head: number; primary: number; secondary: number; detail: number } }) {
    await this.engine.handleAppearanceSave(socket.id, payload.token, payload.outfitId, payload.addonMask, payload.colors, payload.characterId);
  }

  @SubscribeMessage('combat.config')
  onCombatConfig(socket: Socket, payload: { token: string; characterId?: string; targeting: string; movement: string; attackRange?: number }) {
    this.engine.handleCombatConfig(socket.id, payload.token, payload.targeting, payload.movement, payload.attackRange, payload.characterId);
  }

  @SubscribeMessage('combat.weaponElementOverride.apply')
  onWeaponElementOverride(socket: Socket, payload: { damageType: import('@aetheria/types').DamageType }) {
    this.engine.handleWeaponElementOverride(socket.id, payload.damageType);
  }

  @SubscribeMessage('combat.weaponElementOverride.remove')
  onWeaponElementOverrideRemove(socket: Socket) {
    this.engine.handleWeaponElementOverrideRemove(socket.id);
  }
}
