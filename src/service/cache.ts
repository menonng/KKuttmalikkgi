/**
 * 조회 결과 캐시.
 *
 * 외부 API 는 느리고 호출 예산이 있다. 같은 단어를 두 번 묻지 않게
 * 긍정(찾음)과 부정(없음) 결과를 모두 캐시한다.
 * 부정 결과는 TTL 을 짧게 둬서, 나중에 위키에 문서가 생기면 다시 찾도록 한다.
 */
import type { Resolution, ResolutionCache } from './types.js';

interface CacheRecord {
  resolution: Resolution;
  storedAt: number;
}

export interface MemoryCacheOptions {
  /** 찾은 단어 TTL(ms). 기본 24시간. */
  positiveTtlMs?: number;
  /** 못 찾은 단어 TTL(ms). 기본 1시간. */
  negativeTtlMs?: number;
  /** 최대 보관 개수. 넘으면 오래된 것부터 버린다. */
  maxEntries?: number;
}

export class MemoryResolutionCache implements ResolutionCache {
  private readonly records = new Map<string, CacheRecord>();
  private readonly positiveTtl: number;
  private readonly negativeTtl: number;
  private readonly maxEntries: number;

  constructor(options: MemoryCacheOptions = {}) {
    this.positiveTtl = options.positiveTtlMs ?? 24 * 3600_000;
    this.negativeTtl = options.negativeTtlMs ?? 3600_000;
    this.maxEntries = options.maxEntries ?? 10_000;
  }

  async get(word: string): Promise<Resolution | null> {
    const record = this.records.get(word);
    if (!record) return null;

    const ttl = record.resolution.status === 'unknown' ? this.negativeTtl : this.positiveTtl;
    if (Date.now() - record.storedAt > ttl) {
      this.records.delete(word);
      return null;
    }
    return { ...record.resolution, origin: 'cache' };
  }

  async set(word: string, resolution: Resolution): Promise<void> {
    if (this.records.size >= this.maxEntries) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
    this.records.set(word, { resolution, storedAt: Date.now() });
  }

  get size(): number {
    return this.records.size;
  }
}

/**
 * 브라우저 localStorage 캐시.
 * 페이지를 새로 열어도 이전 조회 결과가 남아 첫 화면이 빠르다.
 */
export class BrowserResolutionCache implements ResolutionCache {
  private readonly memory: MemoryResolutionCache;

  constructor(
    private readonly prefix = 'kkuttmal:lookup:',
    options: MemoryCacheOptions = {},
  ) {
    this.memory = new MemoryResolutionCache(options);
  }

  private storage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      // 프라이빗 모드/차단 설정에서는 접근 자체가 예외를 던진다.
      return null;
    }
  }

  async get(word: string): Promise<Resolution | null> {
    const fromMemory = await this.memory.get(word);
    if (fromMemory) return fromMemory;

    const storage = this.storage();
    if (!storage) return null;

    try {
      const raw = storage.getItem(this.prefix + word);
      if (!raw) return null;
      const record = JSON.parse(raw) as CacheRecord;
      await this.memory.set(word, record.resolution);
      return { ...record.resolution, origin: 'cache' };
    } catch {
      return null;
    }
  }

  async set(word: string, resolution: Resolution): Promise<void> {
    await this.memory.set(word, resolution);
    const storage = this.storage();
    if (!storage) return;
    try {
      storage.setItem(
        this.prefix + word,
        JSON.stringify({ resolution, storedAt: Date.now() } satisfies CacheRecord),
      );
    } catch {
      // 용량 초과 등은 조용히 무시한다. 캐시는 있으면 좋은 것일 뿐이다.
    }
  }
}
