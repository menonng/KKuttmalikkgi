/**
 * AI 상대의 수 선택 로직.
 *
 * DictionaryIndex(및 그 하위 클래스인 DictionaryStore/BrowserDictionary) 하나만
 * 있으면 Node/브라우저 어디서든 동일하게 동작한다 — 서버가 검증하는 판정과
 * 클라이언트가 미리 보여주는 AI 수가 항상 같은 사전 데이터를 근거로 하게 된다.
 */
import type { DictionaryEntry } from '../core/types.js';
import type { DictionaryIndex } from '../core/dictionaryIndex.js';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'insane';

export interface AiMoveOptions {
  difficulty: Difficulty;
  /** 이미 사용된 단어(양쪽 모두). */
  exclude: ReadonlySet<string>;
  /** 후보를 몇 개까지 살펴볼지 — 클수록 정교하지만 느리다. */
  sampleSize?: number;
  /**
   * "한방단어"(다음 후보가 없는 단어)를 게임 규칙상 낼 수 있는지.
   * false(기본)면 이 함수는 한방단어를 아예 후보에서 뺀다 — 설정에서 이 규칙을
   * 켜고 끄는 것이므로 난이도와 무관하게 모든 난이도에 동일하게 적용된다.
   */
  allowDeadEnd?: boolean;
}

/**
 * previousWord 다음에 AI 가 낼 단어를 고른다. 낼 수 있는 단어가 없으면 null
 * (= AI 가 막혔다 = 플레이어 승리).
 *
 *   easy   — 유효한 후보 중 무작위
 *   normal — 상대를 바로 한방단어로 막다른 골목에 몰지 않는 후보 중 무작위
 *   hard   — 이 수를 두면 상대에게 남는 다음 후보 수가 가장 적은 단어(상대를 압박)
 *   insane — hard 와 같되 더 넓은 후보 풀에서 더 깊이 확인한다
 */
export function chooseAiMove(
  dictionary: DictionaryIndex,
  previousWord: string,
  options: AiMoveOptions,
): DictionaryEntry | null {
  const sampleSize = options.sampleSize ?? 40;
  const allowDeadEnd = options.allowDeadEnd ?? false;
  let candidates = dictionary.nextCandidates(previousWord, {
    exclude: options.exclude,
    limit: sampleSize,
  });
  if (!allowDeadEnd) {
    candidates = candidates.filter((candidate) => !dictionary.isDeadEnd(candidate.word));
  }
  if (candidates.length === 0) return null;

  if (options.difficulty === 'easy') {
    return pickRandom(candidates);
  }

  // normal 이상은 최소한 "성의 있게" 둔다 — 상대를 즉시 한방단어로 막지 않는다.
  const safe = candidates.filter((candidate) => !dictionary.isDeadEnd(candidate.word));
  const pool = safe.length > 0 ? safe : candidates;

  if (options.difficulty === 'normal') {
    return pickRandom(pool);
  }

  // hard/insane — 이 단어를 냈을 때 상대에게 남는 선택지가 가장 적은 것을 고른다.
  const lookahead = options.difficulty === 'insane' ? 200 : 40;
  let best = pool[0]!;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of pool) {
    const usedAfterThisMove = new Set([...options.exclude, candidate.word]);
    const followUps = dictionary.nextCandidates(candidate.word, {
      exclude: usedAfterThisMove,
      limit: lookahead,
    }).length;

    if (followUps < bestScore) {
      bestScore = followUps;
      best = candidate;
    }
  }
  return best;
}

function pickRandom<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}
