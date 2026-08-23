import { describe, expect, it, vi, afterEach } from 'vitest';
import { chooseAiMove } from '../src/game/ai.js';
import { DictionaryStore } from '../src/core/store.js';
import type { DictionaryEntry } from '../src/core/types.js';

function entry(word: string): DictionaryEntry {
  const chars = [...word];
  return {
    word,
    normalized: word,
    first: chars[0]!,
    last: chars[chars.length - 1]!,
    lore: '테스트',
    sources: ['custom'],
  };
}

// 그래프: 가나 -> {나비, 나무} -> 나비 는 비(한방단어, "비"로 시작하는 단어 없음)
//                                나무 -> 무지개 -> 개미 (계속 이어짐)
const dictionary = DictionaryStore.fromEntries(
  ['가나', '나비', '나무', '무지개', '개미'].map(entry),
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('chooseAiMove', () => {
  it('낼 수 있는 단어가 없으면 null 을 돌려준다(AI 패배)', () => {
    const move = chooseAiMove(dictionary, '개미', { difficulty: 'easy', exclude: new Set() });
    expect(move).toBeNull();
  });

  it('easy 는 유효한 후보 중에서 고른다', () => {
    const move = chooseAiMove(dictionary, '가나', { difficulty: 'easy', exclude: new Set() });
    expect(['나비', '나무']).toContain(move?.word);
  });

  it('이미 사용된 단어는 후보에서 제외한다', () => {
    const move = chooseAiMove(dictionary, '가나', {
      difficulty: 'easy',
      exclude: new Set(['나비']),
    });
    expect(move?.word).toBe('나무');
  });

  it('normal 은 상대를 즉시 한방단어로 몰지 않는 후보를 우선한다', () => {
    // '나비'는 한방단어(다음 단어 없음), '나무'는 이어진다 -> normal 은 나무를 골라야 한다.
    vi.spyOn(Math, 'random').mockReturnValue(0); // 무작위성 제거, pool[0] 선택
    const move = chooseAiMove(dictionary, '가나', { difficulty: 'normal', exclude: new Set() });
    expect(move?.word).toBe('나무');
  });

  it('hard 는 상대에게 남는 후보가 가장 적은 수를 고른다', () => {
    // '가나' 다음 후보는 '나비'(한방단어=0개 후속) vs '나무'(1개 후속: 무지개).
    // isDeadEnd 필터로 normal 이상은 안전한 후보(나무)만 pool 에 남으므로
    // 후속 수가 가장 적은 건 나무 자체(무지개 1개)뿐이라 나무가 선택된다.
    const move = chooseAiMove(dictionary, '가나', { difficulty: 'hard', exclude: new Set() });
    expect(move?.word).toBe('나무');
  });

  it('안전한 후보가 하나도 없으면 한방단어라도 낸다', () => {
    const onlyDeadEnd = DictionaryStore.fromEntries(['가나', '나비'].map(entry));
    const move = chooseAiMove(onlyDeadEnd, '가나', { difficulty: 'hard', exclude: new Set() });
    expect(move?.word).toBe('나비');
  });
});
