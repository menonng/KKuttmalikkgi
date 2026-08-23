/**
 * 디스크 캐시가 붙은 HTTP 클라이언트.
 *
 * 목적:
 *  - 오프라인 빌드: 캐시에 있으면 네트워크 없이 그대로 재현된다
 *  - 예의: 호출 간 최소 간격(rate limit)과 User-Agent 를 강제한다
 *  - 안정성: 일시적 오류는 지수 백오프로 재시도한다
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { HttpConfig } from '../core/config.js';
import type { Logger } from '../core/logger.js';

/** 오프라인인데 캐시에도 없을 때. 소스는 이 오류를 잡아 시드로 대체한다. */
export class OfflineError extends Error {
  constructor(url: string) {
    super(`오프라인 모드이고 캐시에도 없음: ${url.split('?')[0]}`);
    this.name = 'OfflineError';
  }
}

interface CacheRecord {
  url: string;
  fetchedAt: string;
  status: number;
  body: string;
}

export interface HttpClientOptions {
  cacheDir: string;
  config: HttpConfig;
  online: boolean;
  logger: Logger;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/** 캐시 파일에 그대로 남기면 안 되는 쿼리 파라미터. */
const SECRET_PARAMS = new Set(['key', 'apikey', 'api_key', 'token', 'access_token', 'secret']);

/** 캐시 레코드에 기록할 URL 에서 비밀값을 가린다(캐시 키는 원본 URL 기준). */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    for (const name of [...url.searchParams.keys()]) {
      if (SECRET_PARAMS.has(name.toLowerCase())) url.searchParams.set(name, '***');
    }
    return url.toString();
  } catch {
    return raw;
  }
}

export class HttpClient {
  private lastRequestAt = 0;
  private readonly cacheDir: string;

  constructor(private readonly options: HttpClientOptions) {
    this.cacheDir = path.join(options.cacheDir, 'http');
  }

  get online(): boolean {
    return this.options.online;
  }

  /** 쿼리 파라미터를 붙여 URL 을 만든다(캐시 키 안정성을 위해 키 정렬). */
  static buildUrl(base: string, params: Record<string, string | number | undefined>): string {
    const url = new URL(base);
    for (const key of Object.keys(params).sort()) {
      const value = params[key];
      if (value === undefined) continue;
      url.searchParams.set(key, String(value));
    }
    return url.toString();
  }

  async getJson<T>(url: string): Promise<T> {
    return JSON.parse(await this.getText(url)) as T;
  }

  async getText(url: string): Promise<string> {
    const cached = await this.readCache(url);
    if (cached && this.isFresh(cached)) return cached.body;

    if (!this.options.online) {
      if (cached) {
        // 오프라인에서는 만료된 캐시라도 쓰는 편이 빌드 재현성에 낫다.
        this.options.logger.debug(`오프라인: 만료 캐시 사용 ${redactUrl(url)}`);
        return cached.body;
      }
      throw new OfflineError(url);
    }

    const body = await this.fetchWithRetry(url);
    await this.writeCache(url, body);
    return body;
  }

  private async fetchWithRetry(url: string): Promise<string> {
    const { retries, timeoutMs, userAgent } = this.options.config;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt += 1) {
      await this.throttle();
      try {
        const response = await fetch(url, {
          headers: { 'user-agent': userAgent, accept: 'application/json, text/plain, */*' },
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (!response.ok) {
          if (RETRYABLE_STATUS.has(response.status) && attempt < retries) {
            lastError = new Error(`HTTP ${response.status}`);
            await this.backoff(attempt);
            continue;
          }
          throw new Error(
            `HTTP ${response.status} ${response.statusText} — ${redactUrl(url)}`,
          );
        }
        return await response.text();
      } catch (error) {
        lastError = error;
        if (attempt >= retries) break;
        this.options.logger.debug(
          `요청 실패(${attempt + 1}/${retries + 1}) ${redactUrl(url)}: ${String(error)}`,
        );
        await this.backoff(attempt);
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async throttle(): Promise<void> {
    const gap = this.options.config.rateLimitMs;
    if (gap <= 0) return;
    const wait = this.lastRequestAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    this.lastRequestAt = Date.now();
  }

  private async backoff(attempt: number): Promise<void> {
    await sleep(2 ** attempt * 500 + Math.random() * 250);
  }

  private isFresh(record: CacheRecord): boolean {
    const ttlMs = this.options.config.cacheTtlHours * 3600_000;
    if (ttlMs <= 0) return false;
    return Date.now() - Date.parse(record.fetchedAt) < ttlMs;
  }

  private cachePath(url: string): string {
    const key = createHash('sha1').update(url).digest('hex');
    // 디렉터리 하나에 파일이 몰리지 않도록 2단계로 쪼갠다.
    return path.join(this.cacheDir, key.slice(0, 2), `${key}.json`);
  }

  private async readCache(url: string): Promise<CacheRecord | null> {
    try {
      return JSON.parse(await readFile(this.cachePath(url), 'utf8')) as CacheRecord;
    } catch {
      return null;
    }
  }

  private async writeCache(url: string, body: string): Promise<void> {
    const file = this.cachePath(url);
    await mkdir(path.dirname(file), { recursive: true });
    const record: CacheRecord = {
      url: redactUrl(url),
      fetchedAt: new Date().toISOString(),
      status: 200,
      body,
    };
    await writeFile(file, JSON.stringify(record), 'utf8');
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
