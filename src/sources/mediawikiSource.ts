/**
 * 위키(MediaWiki API) 기반 소스의 공통 구현.
 *
 * 동작 방식:
 *  1. 시드 파일을 먼저 흘려보낸다 — 오프라인에서도 항상 기준선이 확보된다
 *  2. --online 이면 위키 카테고리/검색을 크롤링해 대량으로 덧붙인다
 *  3. 네트워크가 막히거나 실패하면 경고만 남기고 시드 결과로 계속 진행한다
 *
 * 위키피디아와 팬덤 위키가 동일한 API 를 쓰므로 endpoint 만 갈아끼우면 된다.
 */
import { createHash } from 'node:crypto';
import type { RawEntry } from '../core/types.js';
import { stripParenthetical, stripTitleBrackets } from '../core/normalize.js';
import { MediaWikiClient } from '../net/mediawiki.js';
import { OfflineError } from '../net/httpCache.js';
import { SeedSource, type SeedSourceOptions } from './seedSource.js';
import type { SourceContext } from './types.js';

/** lore 를 무엇으로 채울지. */
export type LoreMode = 'tag' | 'extract';

export interface MediaWikiSourceOptions extends SeedSourceOptions {
  /** api.php 주소. */
  endpoint: string;
  /** 크롤링할 분류 목록. */
  categories?: string[];
  /** 분류로 안 잡히는 항목을 위한 검색어 목록. */
  searches?: string[];
  /** 하위 분류 탐색 깊이. */
  depth?: number;
  /** 소스당 수집 상한. */
  limit?: number;
  /** tag: 고유명사용(소스 태그를 그대로), extract: 문서 요약을 lore 로. */
  loreMode?: LoreMode;
}

/** 사전 항목으로 부적절한 문서 제목(목록/틀/동음이의 페이지 등). */
const TITLE_BLOCK_PATTERN =
  /(목록|일람|틀:|분류:|위키프로젝트|동음이의|다른 뜻|:)/u;

export class MediaWikiSource extends SeedSource {
  protected readonly wikiOptions: MediaWikiSourceOptions;

  constructor(options: MediaWikiSourceOptions) {
    super(options);
    this.wikiOptions = options;
  }

  /** 설정으로 덮어쓸 수 있게 옵션을 해석한다. */
  protected resolved(ctx: SourceContext) {
    return {
      endpoint: ctx.option<string>('endpoint', this.wikiOptions.endpoint),
      categories: ctx.option<string[]>('categories', this.wikiOptions.categories ?? []),
      searches: ctx.option<string[]>('searches', this.wikiOptions.searches ?? []),
      depth: ctx.option<number>('depth', this.wikiOptions.depth ?? 1),
      limit: ctx.option<number>('limit', this.wikiOptions.limit ?? 3_000),
      loreMode: ctx.option<LoreMode>('loreMode', this.wikiOptions.loreMode ?? 'tag'),
      includeSeeds: ctx.option<boolean>('includeSeeds', true),
    };
  }

  override async fingerprint(ctx: SourceContext): Promise<string> {
    const seedPrint = await super.fingerprint(ctx);
    const resolved = this.resolved(ctx);
    const hash = createHash('sha1').update(seedPrint).update(JSON.stringify(resolved));
    // 온라인 수집은 날짜 단위로 지문을 바꿔 하루 한 번 갱신되게 한다.
    hash.update(ctx.online ? new Date().toISOString().slice(0, 10) : 'offline');
    return hash.digest('hex');
  }

  override async *collect(ctx: SourceContext): AsyncIterable<RawEntry> {
    const resolved = this.resolved(ctx);
    if (resolved.includeSeeds) {
      yield* super.collect(ctx);
    }
    if (!ctx.online) {
      ctx.logger.debug(`${this.name}: 오프라인 — 위키 수집 생략`);
      return;
    }

    const client = new MediaWikiClient(ctx.http, resolved.endpoint, ctx.logger);
    const tag = ctx.sourceConfig.lore ?? this.defaultLore;

    try {
      for (const category of resolved.categories) {
        yield* this.harvest(
          ctx,
          client,
          client.categoryMembers(category, { depth: resolved.depth, limit: resolved.limit }),
          resolved.loreMode,
          tag,
        );
      }
      for (const query of resolved.searches) {
        yield* this.harvest(
          ctx,
          client,
          client.search(query, resolved.limit),
          resolved.loreMode,
          tag,
        );
      }
    } catch (error) {
      if (error instanceof OfflineError) {
        ctx.logger.warn(`${this.name}: 캐시 미스로 위키 수집 중단 — 시드만 사용합니다`);
        return;
      }
      // 한 소스의 네트워크 실패로 전체 빌드를 깨뜨리지 않는다.
      ctx.logger.warn(`${this.name}: 위키 수집 실패 (${String(error)}) — 시드만 사용합니다`);
    }
  }

  /** 문서 제목 스트림을 RawEntry 로 바꾼다. loreMode 가 extract 면 요약을 받아 붙인다. */
  private async *harvest(
    ctx: SourceContext,
    client: MediaWikiClient,
    pages: AsyncGenerator<{ title: string; pageid: number }>,
    loreMode: LoreMode,
    tag: string | undefined,
  ): AsyncIterable<RawEntry> {
    const buffer: Array<{ title: string; clean: string; pageid: number }> = [];

    const flush = async function* (this: MediaWikiSource): AsyncIterable<RawEntry> {
      if (buffer.length === 0) return;
      const extracts =
        loreMode === 'extract'
          ? await client.extracts(buffer.map((item) => item.title))
          : new Map<string, string>();

      for (const item of buffer) {
        const lore = extracts.get(item.title) ?? tag;
        yield {
          word: item.clean,
          source: this.name,
          ...(lore ? { lore } : {}),
          extra: { title: item.title, pageid: item.pageid },
        };
      }
      buffer.length = 0;
    }.bind(this);

    for await (const page of pages) {
      if (TITLE_BLOCK_PATTERN.test(page.title)) continue;
      const clean = stripTitleBrackets(stripParenthetical(page.title));
      if (!clean) continue;

      buffer.push({ title: page.title, clean, pageid: page.pageid });
      // extracts API 가 한 번에 20문서까지라 그 단위로 끊어 처리한다.
      if (buffer.length >= 20) yield* flush();
    }
    yield* flush();

    ctx.logger.debug(`${this.name}: 위키 수집 배치 완료`);
  }
}
