import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { WsService } from './core/ws.service';
import { GameState } from './game/game-state';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
})
export class App implements OnInit {
  constructor(
    private readonly ws: WsService,
    private readonly state: GameState,
  ) {}

  ngOnInit() {
    if (!this.ws.connected) this.ws.connect();
    void this.state;
  }
}