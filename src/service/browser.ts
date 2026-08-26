/**
 * 브라우저에서 바로 쓰는 사전 리졸버 조립기.
 *
 * 번들러 없이 <script type="module"> 로 dist/service/browser.js 를
 * 그대로 로드해서 쓸 수 있도록, 이 파일이 가져오는 것은 전부 node: 의존이 없다.
 *
 * 조회 순서(우선순위):
 *   1. 빌드된 정식 사전(dictionary.json) — 있으면 즉시 확정. 여기 들어가는 일반
 *      어휘는 국립국어원(우리말샘) 이 원 출처다(src/sources/koreanDict.ts).
 *   2. 원신 팬덤 위키 — 게임 캐릭터/지역
 *   3. 한국어 위키낱말사전 — 그 외 일반 어휘의 최종 폴백
 *
 * 한국어 위키백과는 쓰지 않는다("단어는 위키피디아에서 찾아보지 마" 요구사항).
 * 국립국어원 오픈 API(우리말샘) 와 네이버 국어사전은 둘 다 인증 키가 필요한데,
 * 그 키를 브라우저 JS 에 그대로 넣으면 누구나 훔쳐 쓸 수 있어 노출할 수 없고
 * (server.ts 는 서버 프로세스에만 있는 환경변수로 안전하게 넘긴다), 네이버 쪽은
 * 설령 키를 넘긴다 해도 브라우저에서 임의 출처로의 요청을 허용하는 CORS 헤더가
 * 없어 직접 fetch 자체가 막힌다 — 그래서 실시간 온라인 확인은 정식 사전에
 * 없는 단어에 한해 원신 위키 + 위키낱말사전(둘 다 CORS 를 여는 MediaWiki API)
 * 으로만 한다. "국립국어원 위주"는 정식 사전(dictionary.json) 자체를 국립국어원
 * 데이터로 채우는 쪽(빌드 시점)에서 지킨다.
 */
import { DictionaryResolver } from './resolver.js';
import { BrowserResolutionCache } from './cache.js';
import { BrowserDictionary } from './browserStore.js';
import { genshinFandomProvider, koreanWiktionaryProvider } from './providers/mediawiki.js';
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

  // 온라인 검색으로 새로 확인된 단어는 즉시 이 사전 인스턴스(+localStorage)에 편입된다 —
  // 같은 단어를 또 만나면 그다음부터는 네트워크 없이 바로 known 이 된다.
  // 호출자가 onLearn 을 더 얹고 싶으면(예: 서버로도 보고) 둘 다 실행한다.
  const learn = dictionary.learn.bind(dictionary);
  const onLearn: LearnHandler = options.onLearn
    ? async (entry) => {
        learn(entry);
        await options.onLearn!(entry);
      }
    : learn;

  const resolver = new DictionaryResolver({
    dictionary,
    providers: [genshinFandomProvider(options.fetchImpl), koreanWiktionaryProvider(options.fetchImpl)],
    cache: new BrowserResolutionCache(),
    onLearn,
  });

  return { resolver, dictionary };
}
