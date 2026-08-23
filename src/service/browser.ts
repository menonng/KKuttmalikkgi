/**
 * 브라우저에서 바로 쓰는 사전 리졸버 조립기.
 *
 * 번들러 없이 <script type="module"> 로 dist/service/browser.js 를
 * 그대로 로드해서 쓸 수 있도록, 이 파일이 가져오는 것은 전부 node: 의존이 없다.
 *
 * 조회 순서(우선순위):
 *   1. 빌드된 정식 사전(dictionary.json) — 있으면 즉시 확정
 *   2. 원신 팬덤 위키 — 게임 캐릭터/지역
 *   3. 한국어 위키백과 — 역사·신화·악마·인물·작품 등(문서 요약이 lore 태그로 자동 분류됨)
 *   4. 한국어 위키낱말사전 — 그 외 일반 어휘의 최종 폴백
 *
 * 국어사전 오픈 API 는 키가 필요해 브라우저에 노출할 수 없으므로 포함하지 않는다.
 * (서버 사이드는 src/service/server.ts 의 createServerResolver 를 쓴다.)
 */
import { DictionaryResolver } from './resolver.js';
import { BrowserResolutionCache } from './cache.js';
import { BrowserDictionary } from './browserStore.js';
import {
  genshinFandomProvider,
  koreanWikipediaProvider,
  koreanWiktionaryProvider,
} from './providers/mediawiki.js';
import type { LearnHandler } from './types.js';

export interface BrowserResolverOptions {
  /** dictionary.json 의 fetch 가능한 URL. 상대경로 가능("./data/dictionary.json"). */
  dictionaryUrl?: string;
  onLearn?: LearnHandler;
  fetchImpl?: typeof fetch;
}

export interface BrowserResolverHandle {
  resolver: DictionaryResolver;
  dictionary: BrowserDictionary;
}

/**
 * 브라우저 리졸버를 만든다. dictionaryUrl 을 주면 정식 사전을 먼저 불러오고,
 * 실패해도(오프라인, 404 등) 온라인 프로바이더만으로 계속 동작한다.
 */
export async function createBrowserResolver(
  options: BrowserResolverOptions = {},
): Promise<BrowserResolverHandle> {
  let dictionary = BrowserDictionary.empty();
  if (options.dictionaryUrl) {
    try {
      dictionary = await BrowserDictionary.fetch(options.dictionaryUrl, options.fetchImpl);
    } catch (error) {
      console.warn('[dictionary] 정식 사전을 불러오지 못해 온라인 검색만으로 동작합니다:', error);
    }
  }

  const resolver = new DictionaryResolver({
    dictionary,
    providers: [
      genshinFandomProvider(options.fetchImpl),
      koreanWikipediaProvider(options.fetchImpl),
      koreanWiktionaryProvider(options.fetchImpl),
    ],
    cache: new BrowserResolutionCache(),
    ...(options.onLearn ? { onLearn: options.onLearn } : {}),
  });

  return { resolver, dictionary };
}
