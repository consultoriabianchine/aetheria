import { Injectable } from '@angular/core';

export interface PublicStats { online: boolean; playersOnline: number; accountsCreated: number; }
export interface PublicCharacter { id: string; name: string; archetype: string; level: number; experience: number; }
export interface PublicNews { id: string; slug: string; title: string; excerpt: string; content: string; coverImage?: string | null; author?: string | null; publishedAt?: string | null; }

@Injectable({ providedIn: 'root' })
export class PublicSiteService {
  private readonly baseUrl = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && window.location.port === '4200'
    ? 'http://localhost:4000'
    : typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4000';

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }

  getStats(): Promise<PublicStats> { return this.get('/public/stats'); }
  getLeaderboard(): Promise<PublicCharacter[]> { return this.get('/public/leaderboard?limit=6'); }
  searchCharacters(query: string): Promise<PublicCharacter[]> { return this.get(`/public/characters/search?q=${encodeURIComponent(query)}&limit=8`); }
  getNews(): Promise<PublicNews[]> { return this.get('/public/news?limit=5'); }
}
