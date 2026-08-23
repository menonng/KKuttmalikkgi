/**
 * 사전 빌드 오케스트레이터.
 *
 *   소스 수집 -> 정규화 -> 검증 -> 중복 병합 -> lore 확정 -> 내보내기
 *
 * 각 단계는 독립 모듈이고 파이프라인은 그것들을 순서대로 이어 붙이기만 한다.
 * 수집은 비동기 스트림이라 소스가 아무리 커도 메모리에 통째로 올리지 않는다.
 */
import type {
  BuildManifest,
  BuildStats,
  DictionaryEntry,
  RawEntry,
  RejectedEntry,
  SourceStats,
} from './types.js';
import { loadConfig, sourceConfigOf, type BuilderConfig } from './config.js';
import { Logger, defaultLogger } from './logger.js';
import { normalizeWord } from './normalize.js';
import { Validator } from './validate.js';
import { LoreEngine } from './lore.js';
import { DedupeEngine } from './dedupe.js';
import { IncrementalCache } from './incremental.js';
import { exportAll } from './export.js';
import { HttpClient } from '../net/httpCache.js';
import { registerBuiltinSources } from '../sources/index.js';
import { resolveSources } from '../sources/registry.js';
import type { DictionarySource, SourceContext } from '../sources/types.js';

export interface BuildOptions {
  configPath?: string;
  rootDir?: string;
  /** 네트워크 수집 허용. 기본 false(시드/캐시만). */
  online?: boolean;
  /** 지문이 같은 소스는 이전 수집 결과를 재사용. */
  incremental?: boolean;
  /** 특정 소스만 빌드(부분 빌드). */
  only?: string[];
  /** 파일을 쓰지 않고 통계만 낸다. */
  dryRun?: boolean;
  /** SQLite 도 함께 내보낸다. */
  sqlite?: boolean;
  logger?: Logger;
}

export interface BuildResult {
  entries: DictionaryEntry[];
  stats: BuildStats;
  manifest?: BuildManifest;
  rejects: RejectedEntry[];
  config: BuilderConfig;
}

export async function build(options: BuildOptions = {}): Promise<BuildResult> {
  const logger = options.logger ?? defaultLogger;
  const rootDir = options.rootDir ?? process.cwd();
  const startedAt = Date.now();

  const config = await loadConfig(options.configPath, rootDir);
  registerBuiltinSources();
  const sources = resolveSources(config, options.only);
  if (sources.length === 0) {
    logger.warn('활성화된 소스가 없습니다. config/builder.config.json 을 확인하세요.');
  }

  const http = new HttpClient({
    cacheDir: config.paths.cache,
    config: config.http,
    online: options.online ?? false,
    logger,
  });
  const cache = new IncrementalCache(config.paths.cache);
  if (options.incremental) await cache.load();

  const validator = new Validator(config.validation);
  const loreEngine = new LoreEngine({
    maxLength: config.maxLoreLength,
    fallback: config.fallbackLore,
  });
  const dedupe = new DedupeEngine();

  const rejects: RejectedEntry[] = [];
  const rejectionsByCode: Record<string, number> = {};
  const perSource: Record<string, SourceStats> = {};
  let collected = 0;
  let accepted = 0;

  for (const source of sources) {
    const sourceConfig = sourceConfigOf(config, source.name, source.defaultPriority);
    const ctx = createContext({ config, sourceConfig, http, logger, online: options.online ?? false });
    const stat: SourceStats = {
      collected: 0,
      accepted: 0,
      rejected: 0,
      unique: 0,
      cached: false,
      durationMs: 0,
    };
    perSource[source.name] = stat;
    const sourceStart = Date.now();

    try {
      const stream = await openStream(source, ctx, cache, options.incremental ?? false);
      stat.cached = stream.cached;
      logger.info(
        `[${source.name}] ${source.label} 수집 ${stream.cached ? '(캐시 재사용)' : '시작'}`,
      );

      for await (const raw of stream.entries) {
        collected += 1;
        stat.collected += 1;

        const word = normalizeWord(raw.word ?? '');
        const formatResult = validator.validate(word);
        const rejection = !formatResult.ok
          ? { code: formatResult.code, reason: formatResult.reason }
          : validator.isExcludedPos(raw.pos)
            ? { code: 'excluded_pos' as const, reason: `제외 대상 품사(${raw.pos})` }
            : null;

        if (rejection) {
          stat.rejected += 1;
          rejectionsByCode[rejection.code] = (rejectionsByCode[rejection.code] ?? 0) + 1;
          if (rejects.length < 10_000) {
            rejects.push({ word: raw.word ?? '', source: source.name, ...rejection });
          }
          continue;
        }

        stat.accepted += 1;
        accepted += 1;
        dedupe.add({
          word,
          lore: raw.lore ?? sourceConfig.lore ?? source.defaultLore,
          source: source.name,
          priority: sourceConfig.priority,
        });
      }
    } catch (error) {
      // 소스 하나가 죽어도 나머지 사전은 만들어져야 한다.
      stat.error = String(error);
      logger.error(`[${source.name}] 수집 실패: ${String(error)}`);
    }

    stat.durationMs = Date.now() - sourceStart;
    logger.info(
      `[${source.name}] 수집 ${stat.collected} / 통과 ${stat.accepted} / 탈락 ${stat.rejected} (${stat.durationMs}ms)`,
    );
  }

  if (options.incremental) await cache.save();

  const entries = dedupe.finalize(loreEngine);
  const uniqueCounts = dedupe.uniqueCounts();
  for (const [name, stat] of Object.entries(perSource)) {
    stat.unique = uniqueCounts[name] ?? 0;
  }

  const finishedAt = Date.now();
  const stats: BuildStats = {
    startedAt: new Date(startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - startedAt,
    collected,
    accepted,
    rejected: collected - accepted,
    merged: dedupe.merged,
    total: entries.length,
    perSource,
    rejectionsByCode,
  };

  if (options.dryRun) {
    logger.info('dry-run: 파일을 쓰지 않았습니다.');
    return { entries, stats, rejects, config };
  }

  const manifest = await exportAll(entries, stats, rejects, {
    distDir: config.paths.dist,
    logger,
    ...(options.sqlite !== undefined ? { sqlite: options.sqlite } : {}),
  });

  return { entries, stats, manifest, rejects, config };
}

interface StreamHandle {
  entries: AsyncIterable<RawEntry>;
  cached: boolean;
}

/** 증분 캐시가 유효하면 캐시 스트림, 아니면 실수집 스트림(캐시에 기록하며)을 준다. */
async function openStream(
  source: DictionarySource,
  ctx: SourceContext,
  cache: IncrementalCache,
  incremental: boolean,
): Promise<StreamHandle> {
  if (!incremental) {
    return { entries: source.collect(ctx), cached: false };
  }

  const fingerprint = await source.fingerprint(ctx);
  if (cache.isFresh(source.name, fingerprint)) {
    return { entries: cache.read(source.name), cached: true };
  }
  return {
    entries: cache.write(source.name, fingerprint, source.collect(ctx)),
    cached: false,
  };
}

function createContext(args: {
  config: BuilderConfig;
  sourceConfig: ReturnType<typeof sourceConfigOf>;
  http: HttpClient;
  logger: Logger;
  online: boolean;
}): SourceContext {
  return {
    config: args.config,
    sourceConfig: args.sourceConfig,
    online: args.online,
    http: args.http,
    logger: args.logger,
    option<T>(key: string, fallback: T): T {
      const value = args.sourceConfig.options?.[key];
      return (value === undefined ? fallback : value) as T;
    },
  };
}
