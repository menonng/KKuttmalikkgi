/**
 * 빌더 설정. config/builder.config.json 을 읽어 기본값과 병합한다.
 * 소스 추가/비활성화, 검증 임계값, 경로, HTTP 정책이 전부 여기서 결정된다.
 */
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ValidationConfig } from './validate.js';
import { DEFAULT_VALIDATION, DEFAULT_MAX_LORE_LENGTH, DEFAULT_FALLBACK_LORE } from './defaults.js';

export type { ValidationConfig } from './validate.js';

export interface SourceConfig {
  /** false 면 수집 자체를 건너뛴다. */
  enabled: boolean;
  /**
   * 낮을수록 우선. 같은 단어가 여러 소스에 있을 때
   * 표시 표기와 lore 순서를 이 값으로 정한다.
   */
  priority: number;
  /** 소스 기본 lore 를 덮어쓴다. */
  lore?: string;
  /** 소스별 개별 옵션(시드 경로, 위키 카테고리, API 키 이름 등). */
  options?: Record<string, unknown>;
}

export interface HttpConfig {
  userAgent: string;
  timeoutMs: number;
  retries: number;
  /** 요청 간 최소 간격(ms). 위키 API 예의상 최소 100ms 권장. */
  rateLimitMs: number;
  /** 디스크 캐시 유효 시간(시간). 0 이면 항상 재요청. */
  cacheTtlHours: number;
}

export interface BuilderConfig {
  /** lore 최대 길이. 넘으면 잘라내고 말줄임표를 붙인다. */
  maxLoreLength: number;
  /** lore 를 전혀 못 구했을 때 쓰는 값. */
  fallbackLore: string;
  validation: ValidationConfig;
  http: HttpConfig;
  paths: {
    seeds: string;
    cache: string;
    dist: string;
  };
  sources: Record<string, SourceConfig>;
}

export const DEFAULT_CONFIG: BuilderConfig = {
  maxLoreLength: DEFAULT_MAX_LORE_LENGTH,
  fallbackLore: DEFAULT_FALLBACK_LORE,
  validation: { ...DEFAULT_VALIDATION },
  http: {
    userAgent: 'KkuttmalikkgiDictionaryBuilder/0.1 (+https://github.com/menonng/kkuttmalikkgi)',
    timeoutMs: 15_000,
    retries: 3,
    rateLimitMs: 150,
    cacheTtlHours: 168,
  },
  paths: {
    seeds: 'data/seeds',
    cache: 'data/cache',
    dist: 'data/dist',
  },
  sources: {},
};

export const DEFAULT_CONFIG_PATH = 'config/builder.config.json';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 깊은 병합. 배열은 덮어쓴다(부분 병합보다 예측 가능해서). */
function mergeDeep<T>(base: T, override: unknown): T {
  if (!isPlainObject(override)) return base;
  if (!isPlainObject(base)) return override as T;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isPlainObject(value) && isPlainObject(current)
      ? mergeDeep(current, value)
      : value;
  }
  return out as T;
}

/**
 * 설정을 읽는다. 파일이 없으면 기본값으로 동작한다(첫 실행 편의).
 * 경로는 모두 rootDir 기준 절대경로로 바꿔서 돌려준다.
 */
export async function loadConfig(
  configPath: string = DEFAULT_CONFIG_PATH,
  rootDir: string = process.cwd(),
): Promise<BuilderConfig> {
  const absoluteConfig = path.isAbsolute(configPath)
    ? configPath
    : path.join(rootDir, configPath);

  let fileConfig: unknown = {};
  if (existsSync(absoluteConfig)) {
    fileConfig = JSON.parse(await readFile(absoluteConfig, 'utf8'));
  }

  const merged = mergeDeep(DEFAULT_CONFIG, fileConfig);
  return {
    ...merged,
    paths: {
      seeds: path.resolve(rootDir, merged.paths.seeds),
      cache: path.resolve(rootDir, merged.paths.cache),
      dist: path.resolve(rootDir, merged.paths.dist),
    },
  };
}

/** 등록된 소스의 설정을 꺼낸다. 설정에 없으면 기본값으로 활성화. */
export function sourceConfigOf(
  config: BuilderConfig,
  name: string,
  fallbackPriority = 100,
): SourceConfig {
  return config.sources[name] ?? { enabled: true, priority: fallbackPriority };
}
