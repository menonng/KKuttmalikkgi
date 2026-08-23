/**
 * 사전 조회 서비스 공개 API.
 *
 * 정식 빌드(사전)에 없는 단어를 실시간으로 검색해 확인하는 계층이다.
 * 브라우저(GitHub Pages)와 Node 서버 양쪽에서 DictionaryResolver 를 그대로 쓴다.
 */
export * from './types.js';
export { DictionaryResolver, type DictionaryResolverOptions, type KnownWordSource } from './resolver.js';
export { MemoryResolutionCache, BrowserResolutionCache } from './cache.js';
export { classifyLore, pickLore } from './loreClassifier.js';
export {
  MediaWikiProvider,
  koreanWikipediaProvider,
  genshinFandomProvider,
  koreanWiktionaryProvider,
} from './providers/mediawiki.js';
export { OpenDictProvider } from './providers/openDict.js';
export { BrowserDictionary } from './browserStore.js';
export { createBrowserResolver, type BrowserResolverOptions, type BrowserResolverHandle } from './browser.js';
export { createServerResolver, type ServerResolverOptions } from './server.js';
