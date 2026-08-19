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

  @SubscribeMessage('game.attack')
  onAttack(socket: Socket, payload: { targetId: string }) {
    this.engine.handleAttack(socket.id, payload.targetId);
  }

  @SubscribeMessage('game.pickup')
  onPickup(socket: Socket, payload: { entityId: string }) {
    void this.engine.handlePickup(socket.id, payload.entityId);
  }

  @SubscribeMessage('inventory.equip')
  onEquip(socket: Socket, payload: { slot: number }) {
    this.engine.handleEquip(socket.id, payload.slot);
  }

  @SubscribeMessage('inventory.unequip')
  onUnequip(socket: Socket, payload: { slot: string }) {
    this.engine.handleUnequip(socket.id, payload.slot);
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

  @SubscribeMessage('appearance.list')
  async onAppearanceList(socket: Socket, payload: { token: string }) {
    await this.engine.handleAppearanceList(socket.id, payload.token);
  }

  @SubscribeMessage('appearance.save')
  async onAppearanceSave(socket: Socket, payload: { token: string; outfitId: number; addonMask: number; colors: { head: number; primary: number; secondary: number; detail: number } }) {
    await this.engine.handleAppearanceSave(socket.id, payload.token, payload.outfitId, payload.addonMask, payload.colors);
  }
}
