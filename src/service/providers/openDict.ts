/**
 * 우리말샘 오픈 API 조회 프로바이더 (서버 전용).
 *
 * API 키가 필요해서 정적 사이트에서는 쓸 수 없다.
 * Node 사전 API 서버가 일반 어휘를 판정할 때 사용한다.
 */
import type { LookupProvider, ProviderHit } from '../types.js';
import { normalizeWord } from '../../core/normalize.js';
import { buildLoreForHeadword, excludeByPos, type OpenDictItem } from '../../net/openDictFormat.js';

export interface OpenDictProviderOptions {
  apiKey: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

interface OpenDictResponse {
  channel?: {
    item?: Array<OpenDictItem & { link?: string }>;
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

    // method=exact 로 요청했으므로, 응답에 오는 item 들은 전부 이 단어의
    // 동음이의어 그룹(사전 편찬 상 표기가 같은 별개의 단어들)이다. 표제어에 붙는
    // 발음/동형어 표시(-, ^)를 걷어내고, 실제로 요청한 단어와 정확히 일치하는
    // 항목만 모아 "동음이의어면 대표 뜻 3개, 아니면 다의어 뜻 3개"를 적용한다.
    let headword: string | null = null;
    let reference: string | undefined;
    const homonymGroup: OpenDictItem[] = [];

    for (const item of data.channel?.item ?? []) {
      if (!item.word) continue;
      const cleaned = item.word.replace(/[-^]/gu, '');
      if (normalizeWord(cleaned) !== target) continue;

      headword ??= cleaned;
      reference ??= item.link;
      homonymGroup.push(item);
    }

    if (!headword) return null;

    // 동음이의어 전부가 동사(인용형)뿐이면 끝말잇기에 쓸 수 있는 단어가 아니다 —
    // "모르는 단어"와 동일하게 취급되도록 null 을 돌려준다.
    const eligible = excludeByPos(homonymGroup);
    if (eligible.length === 0) return null;

    const lore = buildLoreForHeadword(eligible);
    return {
      title: headword,
      ...(lore ? { lore } : {}),
      ...(reference ? { reference } : {}),
    };
  }
}
