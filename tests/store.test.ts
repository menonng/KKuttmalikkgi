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
