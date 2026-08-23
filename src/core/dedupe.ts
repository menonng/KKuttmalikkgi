/**
 * 중복 제거 및 병합 엔진.
 *
 * 정규화된 단어를 키로 O(1) 병합한다. 같은 단어가 여러 소스에서 오면
 * 하나의 엔트리로 합치고 sources / lore 를 우선순위 순으로 누적한다.
 *
 *   모락스 (genshin: "원신") + 모락스 (ars_goetia: "악마학")
 *     -> { word: "모락스", lore: "원신, 악마학", sources: ["genshin", "ars_goetia"] }
 */
import type { DictionaryEntry } from './types.js';
import { dedupeKey, firstChar, lastChar } from './normalize.js';
import type { LoreEngine } from './lore.js';

export interface MergeCandidate {
  /** 정규화 + 검증을 통과한 단어. */
  word: string;
  /** 이 소스가 제공한 lore 조각(없으면 소스 기본값이 이미 채워져 있어야 한다). */
  lore?: string | undefined;
  source: string;
  /** 낮을수록 우선. 표시 표기와 lore/sources 정렬에 쓰인다. */
  priority: number;
}

interface Bucket {
  /** 화면에 보여줄 표기. 우선순위가 가장 높은 소스의 표기를 쓴다. */
  display: string;
  displayPriority: number;
  /** 이 단어를 처음 발견한 소스(통계용). */
  firstSource: string;
  sources: Map<string, number>;
  lores: Array<{ text: string; priority: number }>;
}

export class DedupeEngine {
  private readonly buckets = new Map<string, Bucket>();
  private mergedCount = 0;
  private readonly uniqueBySource = new Map<string, number>();

  /**
   * 후보를 추가한다.
   * @returns 새 단어면 true, 기존 단어에 병합됐으면 false
   */
  add(candidate: MergeCandidate): boolean {
    const key = dedupeKey(candidate.word);
    const existing = this.buckets.get(key);

    if (!existing) {
      this.buckets.set(key, {
        display: candidate.word,
        displayPriority: candidate.priority,
        firstSource: candidate.source,
        sources: new Map([[candidate.source, candidate.priority]]),
        lores: candidate.lore ? [{ text: candidate.lore, priority: candidate.priority }] : [],
      });
      this.uniqueBySource.set(
        candidate.source,
        (this.uniqueBySource.get(candidate.source) ?? 0) + 1,
      );
      return true;
    }

    // 같은 소스가 같은 단어를 두 번 내놓는 경우도 조용히 병합한다.
    if (!existing.sources.has(candidate.source)) {
      existing.sources.set(candidate.source, candidate.priority);
    }
    if (candidate.priority < existing.displayPriority) {
      existing.display = candidate.word;
      existing.displayPriority = candidate.priority;
    }
    if (candidate.lore) {
      existing.lores.push({ text: candidate.lore, priority: candidate.priority });
    }
    this.mergedCount += 1;
    return false;
  }

  /** 병합으로 사라진(=중복이었던) 항목 수. */
  get merged(): number {
    return this.mergedCount;
  }

  /** 고유 단어 수. */
  get size(): number {
    return this.buckets.size;
  }

  /** 소스별로 "처음 발견한 단어" 수. */
  uniqueCounts(): Record<string, number> {
    return Object.fromEntries(this.uniqueBySource);
  }

  /**
   * 최종 엔트리 배열을 만든다.
   * 출력은 항상 사전순으로 정렬해 빌드 결과가 결정적이도록 한다(git diff 안정).
   */
  finalize(loreEngine: LoreEngine): DictionaryEntry[] {
    const entries: DictionaryEntry[] = [];

    for (const bucket of this.buckets.values()) {
      const sources = [...bucket.sources.entries()]
        .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
        .map(([name]) => name);

      const lore = loreEngine.merge(
        [...bucket.lores]
          .sort((a, b) => a.priority - b.priority)
          .map((item) => item.text),
      );

      entries.push({
        word: bucket.display,
        normalized: bucket.display,
        first: firstChar(bucket.display),
        last: lastChar(bucket.display),
        lore,
        sources,
      });
    }

    entries.sort((a, b) => (a.word < b.word ? -1 : a.word > b.word ? 1 : 0));
    return entries;
  }
}
