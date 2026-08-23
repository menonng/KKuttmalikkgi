import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserDictionary } from '../src/service/browserStore.js';
import type { DictionaryEntry } from '../src/core/types.js';

function entry(word: string, sources: string[] = ['korean_dict']): DictionaryEntry {
  const chars = [...word];
  return {
    word,
    normalized: word,
    first: chars[0]!,
    last: chars[chars.length - 1]!,
    lore: '테스트',
    sources,
  };
}

/** localStorage 를 흉내내는 최소 구현. */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

describe('BrowserDictionary.fetch', () => {
  it('dictionary.json 을 fetch 해서 조회 가능한 사전을 만든다', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [entry('벤티', ['genshin'])],
    })) as unknown as typeof fetch;

    const dict = await BrowserDictionary.fetch('./data/dictionary.json', fetchImpl);
    expect(dict.get('벤티')?.word).toBe('벤티');
    expect(dict.size).toBe(1);
  });

  it('실패하면 에러를 던진다', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404 })) as unknown as typeof fetch;
    await expect(BrowserDictionary.fetch('./x.json', fetchImpl)).rejects.toThrow(/HTTP 404/u);
  });
});

describe('BrowserDictionary.learn (실시간 학습 저장)', () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('학습한 단어를 즉시 조회할 수 있고 localStorage 에도 남긴다', () => {
    const dict = BrowserDictionary.empty();
    dict.learn(entry('페르세포네', ['wikipedia']));

    expect(dict.get('페르세포네')?.word).toBe('페르세포네');
    const saved = JSON.parse(storage.getItem('kkuttmal:learnedWords')!);
    expect(saved).toHaveLength(1);
    expect(saved[0].word).toBe('페르세포네');
  });

  it('새로 fetch 한 사전이 이전에 학습한 단어를 이어받는다', async () => {
    storage.setItem('kkuttmal:learnedWords', JSON.stringify([entry('페르세포네', ['wikipedia'])]));

    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => [entry('벤티', ['genshin'])],
    })) as unknown as typeof fetch;

    const dict = await BrowserDictionary.fetch('./data/dictionary.json', fetchImpl);
    expect(dict.get('벤티')).toBeDefined();
    expect(dict.get('페르세포네')).toBeDefined();
    expect(dict.size).toBe(2);
  });

  it('이미 아는 단어를 다시 학습해도 중복 저장하지 않는다', () => {
    const dict = BrowserDictionary.empty();
    dict.learn(entry('벤티'));
    dict.learn(entry('벤티'));

    const saved = JSON.parse(storage.getItem('kkuttmal:learnedWords')!);
    expect(saved).toHaveLength(1);
  });

  it('localStorage 가 없어도(예외를 던져도) 색인 학습 자체는 성공한다', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('차단됨');
      },
      setItem: () => {
        throw new Error('차단됨');
      },
    });

    const dict = BrowserDictionary.empty();
    expect(() => dict.learn(entry('벤티'))).not.toThrow();
    expect(dict.get('벤티')).toBeDefined();
  });
});
