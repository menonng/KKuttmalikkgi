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

export interface SearchOptions {
  /** 최대 반환 개수. */
  limit?: number;
}

/**
 * "고유명사류" 판정 — 순수히 korean_dict(일반 어휘) 소스로만 이뤄진 항목이 아니면
 * 고유명사/작품명/캐릭터 등으로 취급한다. 시작 단어 뽑기의 일반명사·고유명사 균형에 쓴다.
 */
function isProperNounEntry(entry: DictionaryEntry): boolean {
  return !entry.sources.every((source) => source === 'korean_dict');
}

export class DictionaryIndex {
  protected readonly entries: DictionaryEntry[];
  private readonly byWord = new Map<string, DictionaryEntry>();
  private readonly byFirst = new Map<string, DictionaryEntry[]>();
  private readonly byLast = new Map<string, DictionaryEntry[]>();
  /** 시작 단어 뽑기용으로 미리 갈라둔 두 풀. */
  private readonly commonNouns: DictionaryEntry[] = [];
  private readonly properNouns: DictionaryEntry[] = [];

  constructor(entries: DictionaryEntry[]) {
    this.entries = [];
    for (const entry of entries) this.index(entry);
  }

  private index(entry: DictionaryEntry): void {
    this.entries.push(entry);
    this.byWord.set(entry.word.toLowerCase(), entry);
    pushTo(this.byFirst, entry.first, entry);
    pushTo(this.byLast, entry.last, entry);
    (isProperNounEntry(entry) ? this.properNouns : this.commonNouns).push(entry);
  }

  /**
   * 항목을 하나 더 색인에 넣는다(실시간 학습용) — 이미 아는 단어면 조용히 무시한다.
   * @returns 실제로 추가됐으면 true
   */
  add(entry: DictionaryEntry): boolean {
    if (this.has(entry.word)) return false;
    this.index(entry);
    return true;
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

  /** 무작위 항목 하나 — "오늘의 단어" 표시 등 순수 무작위가 필요할 때 쓴다. */
  random(): DictionaryEntry | undefined {
    if (this.entries.length === 0) return undefined;
    return this.entries[Math.floor(Math.random() * this.entries.length)];
  }

  /**
   * 대전 시작 단어를 뽑는다. 사전 전체를 그대로 무작위로 뽑으면 원신/신화/악마학
   * 같은 고유명사류 소스가 절대다수라(일반 어휘보다 훨씬 많음) 시작 단어가
   * 고유명사에 심하게 치우친다. 두 풀(일반명사/고유명사)을 반반 확률로 골라
   * "고유명사가 일반명사보다 많아지지 않도록" 강제한다 — 둘 중 한쪽이 비어 있으면
   * 나머지 쪽에서만 뽑는다.
   */
  randomStartWord(): DictionaryEntry | undefined {
    const hasCommon = this.commonNouns.length > 0;
    const hasProper = this.properNouns.length > 0;
    if (!hasCommon && !hasProper) return undefined;

    const pickFromCommon = hasCommon && (!hasProper || Math.random() < 0.5);
    const pool = pickFromCommon ? this.commonNouns : this.properNouns;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * 부분 문자열 검색 — 입력을 포함하는 모든 단어를 돌려준다("단어 검색 시 그 단어를
   * 포함하는 건 모두 출력"). 완전 일치 -> 접두 일치 -> 그 외 포함 순으로 정렬한다.
   */
  search(query: string, options: SearchOptions = {}): DictionaryEntry[] {
    const needle = normalizeWord(query);
    if (!needle) return [];
    const limit = options.limit ?? 50;

    const exact: DictionaryEntry[] = [];
    const prefix: DictionaryEntry[] = [];
    const contains: DictionaryEntry[] = [];

    for (const entry of this.entries) {
      if (entry.word === needle) exact.push(entry);
      else if (entry.word.startsWith(needle)) prefix.push(entry);
      else if (entry.word.includes(needle)) contains.push(entry);
    }

    return [...exact, ...prefix, ...contains].slice(0, limit);
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
