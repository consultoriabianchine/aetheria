import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import type { ClientMessage } from '@aetheria/protocol';

export const WS_URL = 'http://localhost:4000';

export interface WsEvent {
  event: string;
  data: unknown;
  seq: number;
}

@Injectable({ providedIn: 'root' })
export class WsService {
  private socket: Socket | null = null;
  private seq = 0;
  readonly events$ = new Subject<WsEvent>();

  connect(url: string = WS_URL) {
    if (this.socket?.connected) return;
    this.socket?.disconnect();
    this.socket = io(url, { transports: ['websocket', 'polling'] });
    this.socket.onAny((event: string, data: unknown) => {
      this.events$.next({ event, data, seq: this.seq++ });
    });
    this.socket.on('connect', () => this.events$.next({ event: 'system.connected', data: null, seq: this.seq++ }));
    this.socket.on('disconnect', () => this.events$.next({ event: 'system.disconnected', data: null, seq: this.seq++ }));
  }

  get connected(): boolean {
    return this.socket?.connected ?? false;
  }

  send(msg: ClientMessage) {
    this.socket?.emit(msg.type, msg as never);
  }

  disconnect() {
    this.socket?.disconnect();
    this.socket = null;
  }
}