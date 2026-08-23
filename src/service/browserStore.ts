/**
 * 브라우저용 사전 로더.
 *
 * DictionaryStore(core/store.ts)는 node:fs 로 파일을 읽는다.
 * 정적 사이트(GitHub Pages)에서는 fetch 로 dictionary.json 을 받아와야 하므로
 * 별도 로더를 두지만, 조회/판정 로직은 DictionaryIndex 를 그대로 상속해 쓴다 —
 * canFollow/nextCandidates/isDeadEnd 가 Node 서버와 완전히 동일하게 동작한다
 * (AI 상대가 다음 수를 고를 때, 게임 서버와 클라이언트가 같은 판정을 내려야 하므로 중요하다).
 *
 * 실시간 학습: 온라인 검색으로 실재가 확인된 단어(DictionaryResolver 의 onLearn 훅)를
 * 이 브라우저의 localStorage 에 저장해둔다. 같은 단어를 다음에 만나면(같은 세션이든,
 * 나중에 다시 방문했든) 네트워크 없이 즉시 "known" 으로 잡힌다 — 정식 사전(dictionary.json)
 * 자체를 늘리는 것은 아니지만("실시간으로 목록에 추가"의 사용자별 근사치),
 * 정식 사전 갱신은 빌더의 --online 빌드(서버/CI)가 담당한다.
 */
import type { DictionaryEntry } from '../core/types.js';
import { DictionaryIndex } from '../core/dictionaryIndex.js';
import type { KnownWordSource } from './resolver.js';

const LEARNED_WORDS_KEY = 'kkuttmal:learnedWords';
/** localStorage 용량 보호용 상한. */
const MAX_LEARNED_WORDS = 5_000;

export class BrowserDictionary extends DictionaryIndex implements KnownWordSource {
  static empty(): BrowserDictionary {
    return new BrowserDictionary([]);
  }

  /**
   * dictionary.json 을 fetch 로 받아와 조회 가능한 사전을 만든다.
   * 이 브라우저가 이전에 학습해둔 단어(localStorage)도 함께 얹는다.
   */
  static async fetch(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<BrowserDictionary> {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`사전 산출물을 불러오지 못했습니다: HTTP ${response.status} (${url})`);
    }
    const entries = (await response.json()) as DictionaryEntry[];
    const dictionary = new BrowserDictionary(entries);
    dictionary.restoreLearned();
    return dictionary;
  }

  private storage(): Storage | null {
    try {
      return globalThis.localStorage ?? null;
    } catch {
      return null;
    }
  }

  private readLearned(): DictionaryEntry[] {
    const storage = this.storage();
    if (!storage) return [];
    try {
      const raw = storage.getItem(LEARNED_WORDS_KEY);
      return raw ? (JSON.parse(raw) as DictionaryEntry[]) : [];
    } catch {
      return [];
    }
  }

  /** 저장돼 있던 학습 단어를 색인에 얹는다(중복은 add() 가 알아서 건너뛴다). */
  private restoreLearned(): void {
    for (const entry of this.readLearned()) this.add(entry);
  }

  /**
   * 새로 확인된 단어를 색인 + localStorage 양쪽에 넣는다.
   * DictionaryResolver 의 onLearn 훅이 이 메서드를 그대로 호출한다.
   */
  learn(entry: DictionaryEntry): void {
    if (!this.add(entry)) return; // 이미 아는 단어면 저장도 건너뛴다.

    const storage = this.storage();
    if (!storage) return;
    try {
      const list = this.readLearned().filter((item) => item.word !== entry.word);
      list.push(entry);
      // 너무 오래되면 앞에서부터 밀어낸다(최근 학습분을 우선 보존).
      const trimmed = list.length > MAX_LEARNED_WORDS ? list.slice(list.length - MAX_LEARNED_WORDS) : list;
      storage.setItem(LEARNED_WORDS_KEY, JSON.stringify(trimmed));
    } catch {
      // 용량 초과 등은 조용히 무시한다 — 이번 세션 안에서는 이미 색인에 들어가 있다.
    }
  }
}
