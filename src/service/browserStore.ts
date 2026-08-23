/**
 * 브라우저용 사전 로더.
 *
 * DictionaryStore(core/store.ts)는 node:fs 로 파일을 읽는다.
 * 정적 사이트(GitHub Pages)에서는 fetch 로 dictionary.json 을 받아와야 하므로
 * 별도 로더를 두지만, 조회/판정 로직은 DictionaryIndex 를 그대로 상속해 쓴다 —
 * canFollow/nextCandidates/isDeadEnd 가 Node 서버와 완전히 동일하게 동작한다
 * (AI 상대가 다음 수를 고를 때, 게임 서버와 클라이언트가 같은 판정을 내려야 하므로 중요하다).
 */
import type { DictionaryEntry } from '../core/types.js';
import { DictionaryIndex } from '../core/dictionaryIndex.js';
import type { KnownWordSource } from './resolver.js';

export class BrowserDictionary extends DictionaryIndex implements KnownWordSource {
  static empty(): BrowserDictionary {
    return new BrowserDictionary([]);
  }

  /** dictionary.json 을 fetch 로 받아와 조회 가능한 사전을 만든다. */
  static async fetch(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<BrowserDictionary> {
    const response = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!response.ok) {
      throw new Error(`사전 산출물을 불러오지 못했습니다: HTTP ${response.status} (${url})`);
    }
    const entries = (await response.json()) as DictionaryEntry[];
    return new BrowserDictionary(entries);
  }
}
