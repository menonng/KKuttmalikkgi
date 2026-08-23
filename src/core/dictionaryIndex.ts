/**
 * 사전 인덱스 — 조회 로직의 순수(Node/브라우저 어디서나 동작) 핵심.
 *
 * DictionaryStore(core/store.ts, node:fs 로 파일을 읽음)와
 * BrowserDictionary(service/browserStore.ts, fetch 로 읽음)가
 * 이 클래스를 상속해 "어떻게 데이터를 가져오는가"만 다르게 구현한다.
 * 조회/판정 로직 자체는 완전히 동일해야 하므로 한 곳에만 둔다.
 */
import type { DictionaryEntry } from './types.js';
import { normalizeWord } from './normalize.js';
import { chainHeads } from './hangul.js';

export interface NextCandidateOptions {
  /** 이미 사용된 단어(끝말잇기는 재사용 금지). */
  exclude?: ReadonlySet<string>;
  /** 최대 반환 개수. */
  limit?: number;
}

export class DictionaryIndex {
  protected readonly entries: readonly DictionaryEntry[];
  private readonly byWord = new Map<string, DictionaryEntry>();
  private readonly byFirst = new Map<string, DictionaryEntry[]>();
  private readonly byLast = new Map<string, DictionaryEntry[]>();

  constructor(entries: DictionaryEntry[]) {
    this.entries = entries;
    for (const entry of entries) {
      this.byWord.set(entry.word.toLowerCase(), entry);
      pushTo(this.byFirst, entry.first, entry);
      pushTo(this.byLast, entry.last, entry);
    }
  }

  get size(): number {
    return this.entries.length;
  }

  /** 플레이어 입력을 정규화해 조회한다("리 제로…" 도 맞게 찾는다). */
  get(word: string): DictionaryEntry | undefined {
    return this.byWord.get(normalizeWord(word).toLowerCase());
  }

  has(word: string): boolean {
    return this.get(word) !== undefined;
  }

  startingWith(char: string): readonly DictionaryEntry[] {
    return this.byFirst.get(char) ?? [];
  }

  endingWith(char: string): readonly DictionaryEntry[] {
    return this.byLast.get(char) ?? [];
  }

  /**
   * 끝말잇기 규칙 판정. 두음법칙을 인정한다.
   * (앞 단어가 "말"로 끝나면 "말"로 시작하는 단어, "락"이면 "락"/"낙" 모두 허용)
   */
  canFollow(previousWord: string, nextWord: string): boolean {
    const previous = this.get(previousWord);
    const next = this.get(nextWord);
    if (!previous || !next) return false;
    return chainHeads(previous.last).includes(next.first);
  }

  /** 다음에 낼 수 있는 단어 후보. 봇 플레이어와 힌트 기능이 쓴다. */
  nextCandidates(previousWord: string, options: NextCandidateOptions = {}): DictionaryEntry[] {
    const previous = this.get(previousWord);
    if (!previous) return [];

    const limit = options.limit ?? 20;
    const exclude = options.exclude;
    const out: DictionaryEntry[] = [];

    for (const head of chainHeads(previous.last)) {
      for (const entry of this.startingWith(head)) {
        if (exclude?.has(entry.word)) continue;
        out.push(entry);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  /** 한방단어(다음 단어가 없는 단어) 여부 — 밸런스 조정/AI 판단용. */
  isDeadEnd(word: string): boolean {
    const entry = this.get(word);
    if (!entry) return false;
    return chainHeads(entry.last).every((head) => this.startingWith(head).length === 0);
  }

  /** 무작위 항목 하나 — "오늘의 단어" 표시, 첫 턴 단어 뽑기 등에 쓴다. */
  random(): DictionaryEntry | undefined {
    if (this.entries.length === 0) return undefined;
    return this.entries[Math.floor(Math.random() * this.entries.length)];
  }
}

function pushTo(
  map: Map<string, DictionaryEntry[]>,
  key: string,
  entry: DictionaryEntry,
): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(entry);
  else map.set(key, [entry]);
}
