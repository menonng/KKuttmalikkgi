/**
 * 우리말샘 오픈 API 조회 프로바이더 (서버 전용).
 *
 * API 키가 필요해서 정적 사이트에서는 쓸 수 없다.
 * Node 사전 API 서버가 일반 어휘를 판정할 때 사용한다.
 */
import type { LookupProvider, ProviderHit } from '../types.js';
import { normalizeWord } from '../../core/normalize.js';

export interface OpenDictProviderOptions {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OpenDictResponse {
  channel?: {
    item?: Array<{
      word?: string;
      link?: string;
      sense?: Array<{ definition?: string }> | { definition?: string };
    }>;
  };
}

export class OpenDictProvider implements LookupProvider {
  readonly id = 'korean_dict';
  readonly label = '우리말샘';
  readonly priority = 90;

  constructor(private readonly options: OpenDictProviderOptions) {}

  async lookup(word: string): Promise<ProviderHit | null> {
    const target = normalizeWord(word);
    if (!target) return null;

    const url = new URL(this.options.endpoint ?? 'https://opendict.korean.go.kr/api/search');
    url.searchParams.set('key', this.options.apiKey);
    url.searchParams.set('q', target);
    url.searchParams.set('req_type', 'json');
    url.searchParams.set('num', '10');
    // method=exact: 표제어가 정확히 일치하는 것만 받는다.
    url.searchParams.set('method', 'exact');

    const doFetch = this.options.fetchImpl ?? globalThis.fetch;
    let data: OpenDictResponse;
    try {
      const response = await doFetch(url.toString(), {
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      data = (await response.json()) as OpenDictResponse;
    } catch {
      return null;
    }

    for (const item of data.channel?.item ?? []) {
      if (!item.word) continue;
      // 표제어에 붙는 발음/동형어 표시를 걷어내고 비교한다.
      const headword = item.word.replace(/[-^]/gu, '');
      if (normalizeWord(headword) !== target) continue;

      const senses = Array.isArray(item.sense) ? item.sense : item.sense ? [item.sense] : [];
      const definition = senses.find((sense) => sense.definition)?.definition;
      return {
        title: headword,
        ...(definition ? { lore: definition } : {}),
        ...(item.link ? { reference: item.link } : {}),
      };
    }
    return null;
  }
}
