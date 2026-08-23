/**
 * 소스 인터페이스.
 *
 * 새 소스를 추가하려면 이 인터페이스만 구현하고 registry 에 등록하면 된다.
 * 파이프라인은 소스가 무엇을 어떻게 긁어오는지 전혀 알지 못한다.
 */
import type { RawEntry } from '../core/types.js';
import type { BuilderConfig, SourceConfig } from '../core/config.js';
import type { HttpClient } from '../net/httpCache.js';
import type { Logger } from '../core/logger.js';

export interface SourceContext {
  config: BuilderConfig;
  /** 이 소스에 대한 설정(우선순위, lore 오버라이드, 개별 옵션). */
  sourceConfig: SourceConfig;
  /** 네트워크 수집 허용 여부. false 면 시드/캐시만 사용한다. */
  online: boolean;
  http: HttpClient;
  logger: Logger;
  /** 소스별 옵션 헬퍼. */
  option<T>(key: string, fallback: T): T;
}

export interface DictionarySource {
  /** 고유 id. export 의 sources 배열에 그대로 들어간다. */
  readonly name: string;
  /** 사람이 읽는 이름(로그/문서용). */
  readonly label: string;
  /** 항목이 lore 를 제공하지 않을 때 쓰는 기본 태그. 예: "원신" */
  readonly defaultLore?: string;
  /** 설정에 우선순위가 없을 때 쓰는 기본값. 낮을수록 우선. */
  readonly defaultPriority: number;

  /**
   * 입력이 바뀌었는지 판단하는 지문.
   * 증분 빌드에서 값이 그대로면 이전 수집 결과를 재사용한다.
   */
  fingerprint(ctx: SourceContext): Promise<string>;

  /** 원시 항목 스트림. 대용량을 고려해 비동기 이터레이터로 흘린다. */
  collect(ctx: SourceContext): AsyncIterable<RawEntry>;
}
