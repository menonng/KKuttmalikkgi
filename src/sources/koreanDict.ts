/**
 * 한국어 표준 어휘 소스.
 *
 * 세 갈래로 어휘를 모은다:
 *  1. 시드 파일 — 최소 기준선
 *  2. 로컬 코퍼스 파일(TSV/텍스트) — 10만 단위 대량 투입 경로.
 *     "단어<TAB>뜻풀이" 형식이며 스트리밍으로 읽어 메모리를 아낀다.
 *  3. 우리말샘 오픈 API — 키가 있을 때만. 뜻풀이를 그대로 lore 로 쓴다.
 *
 * 일반 어휘의 lore 는 태그가 아니라 사전 뜻풀이다.
 *   륨침대 -> "주로 알루미늄을 뼈대로 하는 간이 침대."
 */
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { RawEntry } from '../core/types.js';
import { HttpClient, OfflineError } from '../net/httpCache.js';
import { buildLoreForHeadword, groupByHeadword, type OpenDictItem } from '../net/openDictFormat.js';
import { SeedSource } from './seedSource.js';
import type { SourceContext } from './types.js';

/** 우리말샘 오픈 API 응답(JSON 모드) 중 실제로 쓰는 부분만. */
interface OpenDictResponse {
  channel?: {
    total?: number;
    item?: OpenDictItem[];
  };
}

const DEFAULT_ENDPOINT = 'https://opendict.korean.go.kr/api/search';

export class KoreanDictSource extends SeedSource {
  constructor() {
    super({
      name: 'korean_dict',
      label: '국어사전',
      defaultPriority: 90,
    });
  }

  private resolved(ctx: SourceContext) {
    return {
      /** 저장소에 넣어둔 대량 어휘 파일(경로는 프로젝트 루트 기준). */
      corpusFiles: ctx.option<string[]>('corpusFiles', ['data/corpus/korean-words.tsv']),
      endpoint: ctx.option<string>('endpoint', DEFAULT_ENDPOINT),
      apiKeyEnv: ctx.option<string>('apiKeyEnv', 'KOREAN_DICT_API_KEY'),
      /** API 로 훑을 질의어. 보통 자모/음절 단위로 넓게 훑는다. */
      queries: ctx.option<string[]>('queries', []),
      perQuery: ctx.option<number>('perQuery', 1_000),
    };
  }

  override async fingerprint(ctx: SourceContext): Promise<string> {
    const hash = createHash('sha1').update(await super.fingerprint(ctx));
    const resolved = this.resolved(ctx);
    for (const file of resolved.corpusFiles) {
      const absolute = path.resolve(process.cwd(), file);
      if (!existsSync(absolute)) continue;
      const stat = statSync(absolute);
      // 대용량 파일은 내용 대신 크기+수정시각으로 지문을 만든다.
      hash.update(`${absolute}:${stat.size}:${stat.mtimeMs}`);
    }
    hash.update(JSON.stringify({ ...resolved, corpusFiles: undefined }));
    hash.update(ctx.online && process.env[resolved.apiKeyEnv] ? 'api-on' : 'api-off');
    return hash.digest('hex');
  }

  override async *collect(ctx: SourceContext): AsyncIterable<RawEntry> {
    yield* super.collect(ctx);

    const resolved = this.resolved(ctx);
    for (const file of resolved.corpusFiles) {
      yield* this.readCorpus(ctx, path.resolve(process.cwd(), file));
    }

    const apiKey = process.env[resolved.apiKeyEnv];
    if (!ctx.online || !apiKey) {
      if (ctx.online && !apiKey) {
        ctx.logger.info(
          `${this.name}: ${resolved.apiKeyEnv} 가 없어 우리말샘 API 수집을 건너뜁니다`,
        );
      }
      return;
    }

    for (const query of resolved.queries) {
      yield* this.fetchFromApi(ctx, query, apiKey, resolved.endpoint, resolved.perQuery);
    }
  }

  /** "단어<TAB>뜻풀이" 파일을 한 줄씩 흘린다. 주석(#)과 빈 줄은 건너뛴다. */
  private async *readCorpus(ctx: SourceContext, file: string): AsyncIterable<RawEntry> {
    if (!existsSync(file)) {
      ctx.logger.debug(`${this.name}: 코퍼스 없음 (${file})`);
      return;
    }

    ctx.logger.info(`${this.name}: 코퍼스 읽는 중 ${file}`);
    const reader = createInterface({
      input: createReadStream(file, 'utf8'),
      crlfDelay: Infinity,
    });

    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const [word, definition] = trimmed.split('\t');
      if (!word) continue;
      yield {
        word,
        source: this.name,
        ...(definition ? { lore: definition } : {}),
      };
    }
  }

  /** 우리말샘 오픈 API 페이지네이션. */
  private async *fetchFromApi(
    ctx: SourceContext,
    query: string,
    apiKey: string,
    endpoint: string,
    perQuery: number,
  ): AsyncIterable<RawEntry> {
    const pageSize = 100;

    for (let start = 1; start <= perQuery; start += pageSize) {
      const url = HttpClient.buildUrl(endpoint, {
        key: apiKey,
        q: query,
        req_type: 'json',
        start,
        num: pageSize,
        sort: 'dict',
      });

      let data: OpenDictResponse;
      try {
        data = await ctx.http.getJson<OpenDictResponse>(url);
      } catch (error) {
        if (error instanceof OfflineError) return;
        ctx.logger.warn(`${this.name}: API 실패 (${query}) — ${String(error)}`);
        return;
      }

      const items = data.channel?.item ?? [];
      if (items.length === 0) return;

      // 한 페이지 안에 같은 표제어가 동음이의어별로 여러 item 으로 흩어져 오므로,
      // 표제어 단위로 먼저 묶어야 "동음이의어 대표 뜻 vs 다의어 뜻" 규칙을 적용할 수 있다.
      // (openDictFormat.ts 의 규칙: 동음이의어가 여럿이면 각 대표 뜻을, 하나뿐이면
      //  그 안의 뜻을 최대 3개까지 모은다.)
      // 페이지 경계에서 같은 단어의 동음이의어가 둘로 쪼개지는 극히 드문 경우엔
      // 그룹핑이 페이지 단위로만 이뤄지지만, 이후 파이프라인의 중복 병합
      // (DedupeEngine + LoreEngine.merge) 이 같은 단어의 여러 RawEntry 를 다시 합쳐주므로
      // 완전히 유실되지는 않는다 — 스트리밍 구조를 유지하기 위한 실용적 절충이다.
      for (const [word, homonymGroup] of groupByHeadword(items)) {
        const lore = buildLoreForHeadword(homonymGroup);
        yield {
          word,
          source: this.name,
          ...(lore ? { lore } : {}),
        };
      }
    }
  }
}
