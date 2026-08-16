import axios from 'axios';
import type { ScraperConfig } from '../config/scraper.config';
import { Logger } from '../utils/logger';
import { withRetry } from '../utils/retry';
import { RateLimiter } from './rate-limiter';

const SAFE_PROTOCOLS = /^https?:\/\//i;

/** Detecta resposta de challenge do Cloudflare ("Just a moment..."). */
function isCloudflareChallenge(text: string, contentType: string): boolean {
  if (!/text|html/i.test(contentType)) return false;
  const head = text.slice(0, 100000).toLowerCase();
  return (
    head.includes('just a moment') ||
    head.includes('_cf_chl_opt') ||
    head.includes('challenges.cloudflare.com') ||
    head.includes('enable javascript and cookies')
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface BinaryResult {
  data: Buffer;
  contentType: string;
}

/**
 * Cliente HTTP centralizado da TibiaWiki: timeout, retry com backoff,
 * User-Agent, rate limiting e tratamento de erros.
 */
export class TibiaWikiHttpClient {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly config: ScraperConfig,
    private readonly logger: Logger,
  ) {
    this.limiter = new RateLimiter(config.concurrency, config.delayMs);
  }

  private assertSafeUrl(url: string): void {
    if (!SAFE_PROTOCOLS.test(url)) {
      throw new Error(`URL não permitida (apenas http/https): ${url}`);
    }
  }

  async getText(url: string): Promise<string> {
    this.assertSafeUrl(url);
    return withRetry(
      () => this.requestText(url),
      {
        retries: this.config.maxRetries,
        baseDelayMs: this.config.delayMs,
        onRetry: (attempt, delay, err) =>
          this.logger.warn(
            'http',
            `Retry ${attempt}/${this.config.maxRetries} de ${url} (${(err as Error).message}) em ${delay}ms`,
          ),
      },
    );
  }

  async getBinary(url: string): Promise<BinaryResult> {
    this.assertSafeUrl(url);
    return withRetry(
      () => this.requestBinary(url),
      {
        retries: this.config.maxRetries,
        baseDelayMs: this.config.delayMs,
        onRetry: (attempt, delay, err) =>
          this.logger.warn(
            'http',
            `Retry ${attempt}/${this.config.maxRetries} de ${url} (${(err as Error).message}) em ${delay}ms`,
          ),
      },
    );
  }

  private async requestText(url: string): Promise<string> {
    const release = await this.limiter.acquire();
    try {
      const res = await axios.get<string>(url, {
        responseType: 'text',
        timeout: this.config.timeoutMs,
        maxRedirects: this.config.maxRedirects,
        headers: {
          'User-Agent': this.config.userAgent,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });
      const contentType = String(res.headers['content-type'] ?? '');
      if (isCloudflareChallenge(String(res.data), contentType)) {
        // Cooldown longo antes de tentar de novo (CF desafia por frequência).
        const cooldown = Math.max(this.config.delayMs * 4, 10000);
        this.logger.warn('http', `Challenge do Cloudflare em ${url} — aguardando ${cooldown}ms`);
        await sleep(cooldown);
        throw new Error('Cloudflare challenge (retry)');
      }
      return res.data;
    } finally {
      release();
    }
  }

  private async requestBinary(url: string): Promise<BinaryResult> {
    const release = await this.limiter.acquire();
    try {
      const res = await axios.get<ArrayBuffer>(url, {
        responseType: 'arraybuffer',
        timeout: this.config.timeoutMs,
        maxRedirects: this.config.maxRedirects,
        headers: {
          'User-Agent': this.config.userAgent,
          Accept: 'image/*',
        },
        validateStatus: (status) => status >= 200 && status < 400,
      });
      return {
        data: Buffer.from(res.data),
        contentType: String(res.headers['content-type'] ?? ''),
      };
    } finally {
      release();
    }
  }
}