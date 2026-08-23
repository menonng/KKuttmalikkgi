/**
 * 예제: 새 소스 추가하기
 *
 *   npx tsx examples/custom-source.ts
 *
 * DictionarySource 인터페이스만 만족하면 어떤 데이터 출처든 붙일 수 있다.
 * 여기서는 "사내 REST API 에서 보스 몬스터 이름을 받아오는 소스"를 흉내 낸다.
 * 실제 코드에서는 src/sources/ 아래에 파일을 만들고
 * src/sources/index.ts 의 registerBuiltinSources() 에 한 줄만 추가하면 된다.
 */
import { createHash } from 'node:crypto';
import { build } from '../src/core/pipeline.js';
import { registerSource } from '../src/sources/registry.js';
import { registerBuiltinSources } from '../src/sources/index.js';
import type { DictionarySource, SourceContext } from '../src/sources/types.js';
import type { RawEntry } from '../src/core/types.js';
import { Logger } from '../src/core/logger.js';

/** 원격 API 응답이라고 가정한 형태. */
interface BossResponse {
  bosses: Array<{ name: string; region: string }>;
}

class BossSource implements DictionarySource {
  readonly name = 'boss_api';
  readonly label = '보스 도감 API';
  readonly defaultLore = '보스 몬스터';
  readonly defaultPriority = 15;

  /** 지문이 그대로면 증분 빌드에서 재수집을 건너뛴다. */
  async fingerprint(ctx: SourceContext): Promise<string> {
    const endpoint = ctx.option<string>('endpoint', 'https://example.invalid/api/bosses');
    return createHash('sha1').update(`${this.name}:${endpoint}`).digest('hex');
  }

  async *collect(ctx: SourceContext): AsyncIterable<RawEntry> {
    const endpoint = ctx.option<string>('endpoint', 'https://example.invalid/api/bosses');

    if (!ctx.online) {
      // 오프라인에서는 내장 기본값으로 대체한다.
      ctx.logger.info(`${this.name}: 오프라인 — 내장 목록 사용`);
      yield* this.fallback();
      return;
    }

    try {
      // ctx.http 는 디스크 캐시 + 재시도 + rate limit 이 붙어 있다.
      const data = await ctx.http.getJson<BossResponse>(endpoint);
      for (const boss of data.bosses) {
        yield {
          word: boss.name,
          lore: `보스 몬스터, ${boss.region}`,
          source: this.name,
        };
      }
    } catch (error) {
      ctx.logger.warn(`${this.name}: API 실패 — 내장 목록으로 대체 (${String(error)})`);
      yield* this.fallback();
    }
  }

  private *fallback(): Generator<RawEntry> {
    for (const name of ['용암거인', '심연의여왕', '얼음군주']) {
      yield { word: name, source: this.name };
    }
  }
}

async function main(): Promise<void> {
  registerBuiltinSources();
  registerSource(new BossSource());

  const result = await build({
    only: ['boss_api', 'genshin'],
    logger: new Logger('warn'),
    dryRun: true,
  });

  console.log(`빌드 결과 ${result.stats.total}건`);
  for (const entry of result.entries.filter((item) => item.sources.includes('boss_api'))) {
    console.log(' ', JSON.stringify(entry));
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
