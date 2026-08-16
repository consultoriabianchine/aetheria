import type { BinaryResult } from '../http/tibiawiki-http.client';
import type { TibiaWikiHttpClient } from '../http/tibiawiki-http.client';

/** Baixa arquivos binários (imagens/GIFs) da Wiki. */
export class AssetScraper {
  constructor(private readonly http: TibiaWikiHttpClient) {}

  async download(url: string): Promise<BinaryResult> {
    return this.http.getBinary(url);
  }
}