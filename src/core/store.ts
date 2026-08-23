/**
 * 런타임 조회 스토어 — 게임 서버가 쓰는 쪽.
 *
 * 빌드 산출물을 메모리에 올려 O(1) 조회를 제공한다.
 * 10만 엔트리 기준으로 Map 3개(단어/첫 글자/끝 글자)면 충분히 가볍고,
 * 멀티플레이 서버가 요청마다 파일을 다시 읽지 않도록 불변 객체로 다룬다.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DictionaryEntry } from './types.js';
import { normalizeWord } from './normalize.js';
import { chainHeads } from './hangul.js';

export interface NextCandidateOptions {
  /** 이미 사용된 단어(끝말잇기는 재사용 금지). */
  exclude?: ReadonlySet<string>;
  /** 최대 반환 개수. */
  limit?: number;
}

export class DictionaryStore {
  private readonly byWord = new Map<string, DictionaryEntry>();
  private readonly byFirst = new Map<string, DictionaryEntry[]>();
  private readonly byLast = new Map<string, DictionaryEntry[]>();

  private constructor(private readonly entries: DictionaryEntry[]) {
    for (const entry of entries) {
      this.byWord.set(entry.word.toLowerCase(), entry);
      pushTo(this.byFirst, entry.first, entry);
      pushTo(this.byLast, entry.last, entry);
    }
  }

  static fromEntries(entries: DictionaryEntry[]): DictionaryStore {
    return new DictionaryStore(entries);
  }

  /** data/dist/dictionary.json 을 읽어 스토어를 만든다. */
  static async load(distDir: string): Promise<DictionaryStore> {
    const file = path.join(distDir, 'dictionary.json');
    const entries = JSON.parse(await readFile(file, 'utf8')) as DictionaryEntry[];
    return new DictionaryStore(entries);
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
  nextCandidates(
    previousWord: string,
    options: NextCandidateOptions = {},
  ): DictionaryEntry[] {
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

  /** 한방단어(다음 단어가 없는 단어) 여부 — 밸런스 조정용. */
  isDeadEnd(word: string): boolean {
    const entry = this.get(word);
    if (!entry) return false;
    return chainHeads(entry.last).every((head) => this.startingWith(head).length === 0);
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
