import { describe, expect, it } from 'vitest';
import { DictionaryStore } from '../src/core/store.js';
import type { DictionaryEntry } from '../src/core/types.js';

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

const store = DictionaryStore.fromEntries([
  entry('벤티'),
  entry('티라미수'),
  entry('수박'),
  entry('나비'),
  entry('이순신'),
  entry('바나나'),
  entry('음악'),
  entry('낙타'),
]);

describe('DictionaryStore', () => {
  it('정규화해서 조회한다', () => {
    expect(store.get(' 벤 티 ')?.word).toBe('벤티');
    expect(store.has('없는단어')).toBe(false);
  });

  it('끝말잇기 연결을 판정한다', () => {
    expect(store.canFollow('벤티', '티라미수')).toBe(true);
    expect(store.canFollow('벤티', '수박')).toBe(false);
  });

  it('두음법칙 연결을 인정한다', () => {
    // "음악"의 끝 글자 '악'은 두음 변형이 없지만, '락' -> '낙' 규칙은 적용된다.
    expect(store.canFollow('음악', '낙타')).toBe(false);
    const dueumStore = DictionaryStore.fromEntries([entry('연락'), entry('낙타')]);
    expect(dueumStore.canFollow('연락', '낙타')).toBe(true);
  });

  it('다음 단어 후보를 준다', () => {
    expect(store.nextCandidates('벤티').map((item) => item.word)).toEqual(['티라미수']);
  });

  it('이미 쓴 단어를 후보에서 뺀다', () => {
    expect(
      store.nextCandidates('벤티', { exclude: new Set(['티라미수']) }),
    ).toEqual([]);
  });

  it('한방단어를 알아낸다', () => {
    // '음악'의 끝 글자 '악'으로 시작하는 단어가 사전에 없다.
    expect(store.isDeadEnd('음악')).toBe(true);
    // '바나나'는 '나비'로 이어지므로 한방단어가 아니다.
    expect(store.isDeadEnd('바나나')).toBe(false);
    expect(store.isDeadEnd('벤티')).toBe(false);
  });

  it('첫 글자 버킷으로 조회한다', () => {
    expect(store.startingWith('나').map((item) => item.word)).toEqual(['나비']);
  });
});

describe('DictionaryIndex.search (포함 검색)', () => {
  const search = DictionaryStore.fromEntries([
    entry('사과'),
    entry('사과나무'),
    entry('왕사과'),
    entry('컴퓨터'),
  ]);

  it('완전 일치를 가장 먼저 돌려준다', () => {
    const results = search.search('사과');
    expect(results.map((e) => e.word)).toEqual(['사과', '사과나무', '왕사과']);
  });

  it('부분 문자열을 포함하는 단어를 모두 돌려준다', () => {
    const results = search.search('과나');
    expect(results.map((e) => e.word)).toEqual(['사과나무']);
  });

  it('일치하는 게 없으면 빈 배열', () => {
    expect(search.search('없는말')).toEqual([]);
  });

  it('limit 을 넘지 않는다', () => {
    expect(search.search('사과', { limit: 1 }).length).toBe(1);
  });
});

describe('DictionaryIndex.randomStartWord (시작 단어는 무조건 보통명사)', () => {
  function properEntry(word: string): DictionaryEntry {
    return { ...entry(word), sources: ['genshin'] };
  }
  function commonEntry(word: string): DictionaryEntry {
    return { ...entry(word), sources: ['korean_dict'] };
  }

  it('고유명사가 훨씬 많아도 시작 단어는 항상 일반명사만 뽑는다', () => {
    const heavilyProper = DictionaryStore.fromEntries([
      ...Array.from({ length: 50 }, (_, i) => properEntry(`고유${i}`)),
      commonEntry('사과'),
    ]);

    for (let i = 0; i < 100; i += 1) {
      expect(heavilyProper.randomStartWord()?.word).toBe('사과');
    }
  });

  it('일반명사 풀이 비어 있으면(예외적으로) 고유명사 풀로 대체한다', () => {
    const onlyProper = DictionaryStore.fromEntries([properEntry('원신단어')]);
    expect(onlyProper.randomStartWord()?.word).toBe('원신단어');

    const onlyCommon = DictionaryStore.fromEntries([commonEntry('일반단어')]);
    expect(onlyCommon.randomStartWord()?.word).toBe('일반단어');
  });

  it('둘 다 비어 있으면 undefined', () => {
    expect(DictionaryStore.fromEntries([]).randomStartWord()).toBeUndefined();
  });
});

describe('DictionaryIndex.add (실시간 학습)', () => {
  it('새 단어를 추가하면 즉시 조회/연결에 반영된다', () => {
    const dict = DictionaryStore.fromEntries([entry('벤티')]);
    expect(dict.get('티라미수')).toBeUndefined();

    const added = dict.add(entry('티라미수'));
    expect(added).toBe(true);
    expect(dict.get('티라미수')?.word).toBe('티라미수');
    expect(dict.canFollow('벤티', '티라미수')).toBe(true);
    expect(dict.size).toBe(2);
  });

  it('이미 아는 단어는 조용히 무시하고 false 를 돌려준다', () => {
    const dict = DictionaryStore.fromEntries([entry('벤티')]);
    expect(dict.add(entry('벤티'))).toBe(false);
    expect(dict.size).toBe(1);
  });
});
