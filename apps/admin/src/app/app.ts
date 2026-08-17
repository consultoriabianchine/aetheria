import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ApiService } from './core/api.service';

@Component({
  selector: 'admin-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styles: `
    :host { display: flex; flex-direction: column; height: 100%; }
    header {
      display: flex; align-items: center; gap: 24px; padding: 10px 18px;
      background: #141a24; border-bottom: 1px solid #232c3a;
    }
    .brand { font-weight: 600; color: #7fd0a0; text-decoration: none; }
    nav a { color: #9db2c8; text-decoration: none; padding: 4px 8px; border-radius: 4px; }
    nav a.active { background: #232c3a; color: #fff; }
    .token { margin-left: auto; display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .token input { width: 180px; }
    main { flex: 1; overflow: auto; padding: 18px; }
  `,
})
export class App {
  constructor(readonly api: ApiService) {}
}
