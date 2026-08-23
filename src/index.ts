/**
 * 공개 API.
 *
 * 빌더(파이프라인)와 런타임(스토어)을 함께 노출한다.
 * 게임 서버는 보통 DictionaryStore 만, CI/스크립트는 build() 를 쓴다.
 */
export * from './core/types.js';
export { build, type BuildOptions, type BuildResult } from './core/pipeline.js';
export {
  loadConfig,
  DEFAULT_CONFIG,
  DEFAULT_CONFIG_PATH,
  type BuilderConfig,
  type SourceConfig,
} from './core/config.js';
export { DictionaryStore } from './core/store.js';
export { normalizeWord, dedupeKey } from './core/normalize.js';
export { Validator } from './core/validate.js';
export { LoreEngine } from './core/lore.js';
export { DedupeEngine } from './core/dedupe.js';
export { buildIndex, exportAll, SCHEMA_VERSION } from './core/export.js';
export { chainHeads, chainTails, applyDueum } from './core/hangul.js';
export { Logger } from './core/logger.js';
export {
  registerBuiltinSources,
  registerSource,
  allSources,
  resolveSources,
  SeedSource,
  MediaWikiSource,
  appendCustomEntry,
  type DictionarySource,
  type SourceContext,
} from './sources/index.js';
