/**
 * MediaWiki 기반 조회 프로바이더.
 *
 * 위키백과와 팬덤 위키가 같은 API 를 쓰므로 엔드포인트만 바꿔 재사용한다.
 * `origin=*` 을 붙여 브라우저에서도 CORS 없이 직접 호출할 수 있게 한다.
 *
 * 판정 절차:
 *   1) 제목으로 바로 조회 — 문서가 있으면 확정
 *   2) 없으면 검색 — 검색 결과 제목을 정규화해 입력과 정확히 같은 것만 인정
 *
 * 2) 가 "없는 단어는 검색을 통해 가져오기" 에 해당한다.
 * 비슷하기만 한 문서는 인정하지 않는다(끝말잇기 판정에 오탐이 치명적이므로).
 */
import type { LookupProvider, ProviderHit } from '../types.js';
import { normalizeWord, stripParenthetical, stripTitleBrackets } from '../../core/normalize.js';

export interface MediaWikiProviderOptions {
  id: string;
  label: string;
  priority: number;
  /** api.php 주소. */
  endpoint: string;
  /** 문서를 볼 수 있는 주소 템플릿. `{title}` 이 치환된다. */
  articleUrl?: string;
  defaultLore?: string;
  /** 도입부 요약을 lore 로 쓸지. false 면 defaultLore 를 쓴다. */
  useExtract?: boolean;
  /** 검색 결과를 몇 개까지 확인할지. */
  searchLimit?: number;
  /** 요청 타임아웃(ms). */
  timeoutMs?: number;
  /** 테스트/서버에서 주입할 fetch 구현. */
  fetchImpl?: typeof fetch;
}

interface QueryPagesResponse {
  query?: {
    pages?: Array<{
      title: string;
      missing?: boolean;
      invalid?: boolean;
      extract?: string;
    }>;
  };
}

interface SearchResponse {
  query?: { search?: Array<{ title: string }> };
}

export class MediaWikiProvider implements LookupProvider {
  readonly id: string;
  readonly label: string;
  readonly priority: number;
  readonly defaultLore?: string;

  constructor(private readonly options: MediaWikiProviderOptions) {
    this.id = options.id;
    this.label = options.label;
    this.priority = options.priority;
    if (options.defaultLore !== undefined) this.defaultLore = options.defaultLore;
  }

  async lookup(word: string): Promise<ProviderHit | null> {
    const target = normalizeWord(word);
    if (!target) return null;

    return (await this.byTitle(word)) ?? (await this.bySearch(target));
  }

  /** 1단계: 제목 직접 조회(리다이렉트 추적 포함). */
  private async byTitle(word: string): Promise<ProviderHit | null> {
    const data = await this.request<QueryPagesResponse>({
      action: 'query',
      prop: 'extracts',
      exintro: '1',
      explaintext: '1',
      exsentences: '1',
      redirects: '1',
      titles: word,
    });

    const page = data?.query?.pages?.[0];
    if (!page || page.missing || page.invalid) return null;
    return this.toHit(page.title, page.extract);
  }

  /** 2단계: 검색 후 제목이 정확히 일치하는 문서만 인정. */
  private async bySearch(target: string): Promise<ProviderHit | null> {
    const data = await this.request<SearchResponse>({
      action: 'query',
      list: 'search',
      srsearch: target,
      srlimit: String(this.options.searchLimit ?? 8),
    });

    for (const result of data?.query?.search ?? []) {
      const cleaned = stripTitleBrackets(stripParenthetical(result.title));
      if (normalizeWord(cleaned) !== target) continue;

      // 제목이 일치하는 문서를 찾았으니 요약까지 받아 lore 를 채운다.
      const detailed = await this.byTitle(result.title);
      return detailed ?? this.toHit(result.title);
    }
    return null;
  }

  private toHit(title: string, extract?: string): ProviderHit {
    const clean = stripTitleBrackets(stripParenthetical(title));
    const lore = this.options.useExtract === false ? undefined : extract?.trim();
    return {
      title: clean,
      ...(lore ? { lore } : {}),
      ...(this.options.articleUrl
        ? { reference: this.options.articleUrl.replace('{title}', encodeURIComponent(title)) }
        : {}),
    };
  }

  private async request<T>(params: Record<string, string>): Promise<T | null> {
    const url = new URL(this.options.endpoint);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    url.searchParams.set('format', 'json');
    url.searchParams.set('formatversion', '2');
    // 브라우저에서 익명 CORS 요청을 허용받기 위한 파라미터.
    url.searchParams.set('origin', '*');

    const doFetch = this.options.fetchImpl ?? globalThis.fetch;
    try {
      const response = await doFetch(url.toString(), {
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 8_000),
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return null;
      return (await response.json()) as T;
    } catch {
      // 네트워크 실패는 "못 찾음"으로 처리한다. 조회 하나가 게임을 막으면 안 된다.
      return null;
    }
  }
}

/** 한국어 위키백과 — 역사·신화·악마·인물·작품 등 넓은 범위를 담당한다. */
export function koreanWikipediaProvider(fetchImpl?: typeof fetch): MediaWikiProvider {
  return new MediaWikiProvider({
    id: 'wikipedia',
    label: '위키백과',
    priority: 80,
    endpoint: 'https://ko.wikipedia.org/w/api.php',
    articleUrl: 'https://ko.wikipedia.org/wiki/{title}',
    defaultLore: '위키백과',
    useExtract: true,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

/** 원신 팬덤 위키 — 캐릭터/지역/무기. */
export function genshinFandomProvider(fetchImpl?: typeof fetch): MediaWikiProvider {
  return new MediaWikiProvider({
    id: 'genshin',
    label: '원신',
    priority: 10,
    endpoint: 'https://genshin-impact.fandom.com/ko/api.php',
    articleUrl: 'https://genshin-impact.fandom.com/ko/wiki/{title}',
    defaultLore: '원신',
    // 팬덤 문서 요약은 게임 내 대사 인용이 섞여 lore 로 부적합한 경우가 많다.
    useExtract: false,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

/**
 * 한국어 위키낱말사전 — 위키백과에 없는 일반 어휘의 최종 폴백.
 * 국어사전 API 키가 없는 브라우저 환경에서 "일반 어휘도 검색으로 확인"하는 역할을 한다.
 */
export function koreanWiktionaryProvider(fetchImpl?: typeof fetch): MediaWikiProvider {
  return new MediaWikiProvider({
    id: 'wiktionary',
    label: '위키낱말사전',
    priority: 95,
    endpoint: 'https://ko.wiktionary.org/w/api.php',
    articleUrl: 'https://ko.wiktionary.org/wiki/{title}',
    defaultLore: '일반 어휘',
    useExtract: true,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}
