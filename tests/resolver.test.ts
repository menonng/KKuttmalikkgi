import { describe, expect, it, vi } from 'vitest';
import { DictionaryResolver } from '../src/service/resolver.js';
import { MemoryResolutionCache } from '../src/service/cache.js';
import type { KnownWordSource } from '../src/service/resolver.js';
import type { LookupProvider, ProviderHit } from '../src/service/types.js';
import type { DictionaryEntry } from '../src/core/types.js';

function fakeDictionary(entries: DictionaryEntry[]): KnownWordSource {
  const map = new Map(entries.map((entry) => [entry.word, entry]));
  return { get: (word) => map.get(word) };
}

function fakeProvider(
  id: string,
  priority: number,
  table: Record<string, ProviderHit | null>,
  defaultLore?: string,
): LookupProvider {
  return {
    id,
    label: id,
    priority,
    ...(defaultLore ? { defaultLore } : {}),
    lookup: vi.fn(async (word: string) => table[word] ?? null),
  };
}

function entry(word: string, lore = '테스트'): DictionaryEntry {
  const chars = [...word];
  return {
    word,
    normalized: word,
    first: chars[0]!,
    last: chars[chars.length - 1]!,
    lore,
    sources: ['custom'],
  };
}

describe('DictionaryResolver', () => {
  it('형식이 잘못된 단어는 네트워크를 타지 않고 invalid 로 끝난다', async () => {
    const provider = fakeProvider('wiki', 80, {});
    const resolver = new DictionaryResolver({ providers: [provider] });

    const result = await resolver.resolve('a');
    expect(result.status).toBe('invalid');
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it('빌드된 사전에 있으면 known 을 즉시 돌려준다', async () => {
    const dictionary = fakeDictionary([entry('벤티', '원신')]);
    const provider = fakeProvider('wiki', 80, {});
    const resolver = new DictionaryResolver({ dictionary, providers: [provider] });

    const result = await resolver.resolve('벤티');
    expect(result.status).toBe('known');
    expect(result.origin).toBe('dictionary');
    expect(provider.lookup).not.toHaveBeenCalled();
  });

  it('사전에 없으면 온라인 프로바이더로 검색해 resolved 를 돌려준다', async () => {
    const provider = fakeProvider(
      'wiki',
      80,
      { 헤파이스토스: { title: '헤파이스토스', lore: '그리스 신화에 나오는 대장장이 신.' } },
      '위키백과',
    );
    const resolver = new DictionaryResolver({ providers: [provider] });

    const result = await resolver.resolve('헤파이스토스');
    expect(result.status).toBe('resolved');
    expect(result.entry?.lore).toBe('그리스 신화'); // loreClassifier 가 태그로 압축
    expect(result.entry?.sources).toEqual(['wiki']);
  });

  it('어디서도 못 찾으면 unknown 을 돌려준다', async () => {
    const provider = fakeProvider('wiki', 80, {});
    const resolver = new DictionaryResolver({ providers: [provider] });

    const result = await resolver.resolve('존재하지않는단어이다');
    expect(result.status).toBe('unknown');
  });

  it('여러 프로바이더가 같은 단어를 확인하면 lore/sources 를 병합한다', async () => {
    const genshin = fakeProvider('genshin', 10, { 모락스: { title: '모락스' } }, '원신');
    const goetia = fakeProvider('ars_goetia', 20, { 모락스: { title: '모락스' } }, '악마학');
    const resolver = new DictionaryResolver({ providers: [goetia, genshin] });

    const result = await resolver.resolve('모락스');
    expect(result.entry?.lore).toBe('원신, 악마학');
    expect(result.entry?.sources).toEqual(['genshin', 'ars_goetia']);
  });

  it('입력과 다른 표기를 확인한 프로바이더 결과는 버린다', async () => {
    const provider = fakeProvider('wiki', 80, {
      비슷한단어: { title: '완전히 다른 문서 제목' },
    });
    const resolver = new DictionaryResolver({ providers: [provider] });

    const result = await resolver.resolve('비슷한단어');
    expect(result.status).toBe('unknown');
  });

  it('resolved 결과는 캐시에 저장되고 두 번째 조회는 프로바이더를 다시 부르지 않는다', async () => {
    const provider = fakeProvider('wiki', 80, { 벤티: { title: '벤티' } }, '위키백과');
    const cache = new MemoryResolutionCache();
    const resolver = new DictionaryResolver({ providers: [provider], cache });

    await resolver.resolve('벤티');
    const second = await resolver.resolve('벤티');

    expect(provider.lookup).toHaveBeenCalledTimes(1);
    expect(second.origin).toBe('cache');
  });

  it('unknown 결과도 캐시된다(부정 캐시)', async () => {
    const provider = fakeProvider('wiki', 80, {});
    const cache = new MemoryResolutionCache();
    const resolver = new DictionaryResolver({ providers: [provider], cache });

    await resolver.resolve('없는단어테스트');
    await resolver.resolve('없는단어테스트');

    expect(provider.lookup).toHaveBeenCalledTimes(1);
  });

  it('resolved 되면 onLearn 훅을 호출한다', async () => {
    const provider = fakeProvider('wiki', 80, { 벤티: { title: '벤티' } }, '원신');
    const onLearn = vi.fn();
    const resolver = new DictionaryResolver({ providers: [provider], onLearn });

    await resolver.resolve('벤티');
    expect(onLearn).toHaveBeenCalledTimes(1);
    expect(onLearn.mock.calls[0]?.[0]).toMatchObject({ word: '벤티' });
  });

  it('동시에 같은 단어를 여러 번 조회해도 프로바이더는 한 번만 호출된다', async () => {
    const provider = fakeProvider('wiki', 80, { 벤티: { title: '벤티' } });
    const resolver = new DictionaryResolver({ providers: [provider] });

    const [a, b, c] = await Promise.all([
      resolver.resolve('벤티'),
      resolver.resolve('벤티'),
      resolver.resolve('벤티'),
    ]);

    expect(provider.lookup).toHaveBeenCalledTimes(1);
    expect(a.status).toBe('resolved');
    expect(b.status).toBe('resolved');
    expect(c.status).toBe('resolved');
  });

  describe('validateTurn', () => {
    const dictionary = fakeDictionary([entry('벤티', '원신'), entry('티라미수', '디저트')]);

    it('정상 턴을 통과시킨다', async () => {
      const resolver = new DictionaryResolver({ dictionary, providers: [] });
      const result = await resolver.validateTurn('티라미수', { previous: '벤티' });
      expect(result.valid).toBe(true);
      expect(result.code).toBe('ok');
    });

    it('끝말이 이어지지 않으면 거절한다', async () => {
      const resolver = new DictionaryResolver({ dictionary, providers: [] });
      const result = await resolver.validateTurn('벤티', { previous: '티라미수' });
      expect(result.valid).toBe(false);
      expect(result.code).toBe('not_chained');
    });

    it('이미 사용한 단어를 거절한다', async () => {
      const resolver = new DictionaryResolver({ dictionary, providers: [] });
      const result = await resolver.validateTurn('벤티', { used: new Set(['벤티']) });
      expect(result.valid).toBe(false);
      expect(result.code).toBe('already_used');
    });

    it('사전에 없는 단어는 unknown_word 로 거절한다', async () => {
      const resolver = new DictionaryResolver({ dictionary, providers: [] });
      const result = await resolver.validateTurn('없는단어입니다요');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('unknown_word');
    });

    it('형식이 잘못된 입력은 invalid_word 로 거절한다', async () => {
      const resolver = new DictionaryResolver({ dictionary, providers: [] });
      const result = await resolver.validateTurn('a');
      expect(result.valid).toBe(false);
      expect(result.code).toBe('invalid_word');
    });
  });
});
