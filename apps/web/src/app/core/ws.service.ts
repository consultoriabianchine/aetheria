import { Injectable } from '@angular/core';
import { io, Socket } from 'socket.io-client';
import { Subject } from 'rxjs';
import type { ClientMessage } from '@aetheria/protocol';

export const WS_URL = resolveWsUrl();

function resolveWsUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:4000';
  const localDev = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '4200';
  return localDev ? 'http://localhost:4000' : window.location.origin;
}

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
    this.socket = io(url, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
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
