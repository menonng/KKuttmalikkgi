/**
 * MediaWiki Action API 클라이언트.
 *
 * ko.wikipedia.org 와 팬덤 위키(*.fandom.com)가 같은 API 를 쓰기 때문에
 * 엔드포인트만 바꾸면 위키 계열 소스를 모두 이 클라이언트로 처리할 수 있다.
 */
import { HttpClient } from './httpCache.js';
import type { Logger } from '../core/logger.js';

export interface WikiPage {
  pageid: number;
  ns: number;
  title: string;
}

interface CategoryMembersResponse {
  query?: { categorymembers?: WikiPage[] };
  continue?: { cmcontinue?: string };
}

interface ExtractsResponse {
  query?: { pages?: Array<{ title: string; extract?: string }> };
}

interface SearchResponse {
  query?: { search?: Array<{ title: string; pageid: number }> };
  continue?: { sroffset?: number };
}

export interface CategoryOptions {
  /** 하위 카테고리를 몇 단계까지 따라갈지. 0 이면 해당 카테고리만. */
  depth?: number;
  /** 총 수집 상한. 폭주 방지용. */
  limit?: number;
}

/** 문서(0번) 네임스페이스. */
const NS_MAIN = 0;
/** 분류(14번) 네임스페이스. */
const NS_CATEGORY = 14;

export class MediaWikiClient {
  constructor(
    private readonly http: HttpClient,
    private readonly endpoint: string,
    private readonly logger: Logger,
  ) {}

  /**
   * 카테고리에 속한 문서 제목을 BFS 로 훑는다.
   * 하위 카테고리 순환은 방문 집합으로 끊는다.
   */
  async *categoryMembers(
    category: string,
    options: CategoryOptions = {},
  ): AsyncGenerator<WikiPage> {
    const depth = options.depth ?? 1;
    const limit = options.limit ?? 5_000;

    const visited = new Set<string>();
    let frontier: string[] = [normalizeCategory(category)];
    let yielded = 0;

    for (let level = 0; level <= depth && frontier.length > 0; level += 1) {
      const next: string[] = [];

      for (const current of frontier) {
        if (visited.has(current)) continue;
        visited.add(current);

        let cmcontinue: string | undefined;
        do {
          const url = HttpClient.buildUrl(this.endpoint, {
            action: 'query',
            list: 'categorymembers',
            cmtitle: current,
            cmlimit: 500,
            cmtype: 'page|subcat',
            format: 'json',
            formatversion: 2,
            cmcontinue,
          });

          const data = await this.http.getJson<CategoryMembersResponse>(url);
          for (const page of data.query?.categorymembers ?? []) {
            if (page.ns === NS_CATEGORY) {
              if (level < depth) next.push(page.title);
              continue;
            }
            if (page.ns !== NS_MAIN) continue;
            yield page;
            yielded += 1;
            if (yielded >= limit) {
              this.logger.debug(`카테고리 수집 상한 도달: ${category} (${limit})`);
              return;
            }
          }
          cmcontinue = data.continue?.cmcontinue;
        } while (cmcontinue);
      }

      frontier = next;
    }
  }

  /** 검색으로 문서 제목을 모은다(카테고리가 정리돼 있지 않은 위키용). */
  async *search(query: string, limit = 200): AsyncGenerator<WikiPage> {
    let offset = 0;
    let yielded = 0;

    while (yielded < limit) {
      const url = HttpClient.buildUrl(this.endpoint, {
        action: 'query',
        list: 'search',
        srsearch: query,
        srlimit: Math.min(50, limit - yielded),
        sroffset: offset,
        format: 'json',
        formatversion: 2,
      });

      const data = await this.http.getJson<SearchResponse>(url);
      const results = data.query?.search ?? [];
      if (results.length === 0) return;

      for (const item of results) {
        yield { pageid: item.pageid, ns: NS_MAIN, title: item.title };
        yielded += 1;
      }

      const nextOffset = data.continue?.sroffset;
      if (nextOffset === undefined) return;
      offset = nextOffset;
    }
  }

  /**
   * 문서 도입부 요약을 가져온다. lore 후보로 쓴다.
   * API 한 번에 최대 20문서까지만 요청할 수 있다.
   */
  async extracts(titles: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();

    for (let i = 0; i < titles.length; i += 20) {
      const batch = titles.slice(i, i + 20);
      const url = HttpClient.buildUrl(this.endpoint, {
        action: 'query',
        prop: 'extracts',
        exintro: 1,
        explaintext: 1,
        exsentences: 1,
        titles: batch.join('|'),
        format: 'json',
        formatversion: 2,
      });

      const data = await this.http.getJson<ExtractsResponse>(url);
      for (const page of data.query?.pages ?? []) {
        if (page.extract) out.set(page.title, page.extract);
      }
    }

    return out;
  }
}

/** "원신 등장인물" -> "분류:원신 등장인물" */
function normalizeCategory(name: string): string {
  return /^(분류|Category):/u.test(name) ? name : `분류:${name}`;
}
