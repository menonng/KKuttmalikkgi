/**
 * 서버 사이드 리졸버 조립기.
 *
 * 브라우저판과 달리 우리말샘 오픈 API(국립국어원, 키 필요)를 서버 프로세스
 * 환경변수로만 안전하게 받아 일반 어휘 판정을 보강한다. "단어는 위키피디아에서
 * 찾아보지 마, 되도록이면 국립국어원에서만" 요구사항대로 위키백과는 프로바이더
 * 목록에서 뺐고, 우리말샘(키가 있을 때)을 원신 위키 다음·위키낱말사전보다
 * 앞에 두어 일반 어휘는 국립국어원이 먼저 판정하게 한다. 빌드 산출물은
 * 디스크에서 직접 읽는다(DictionaryStore, node:fs 사용).
 */
import path from 'node:path';
import { DictionaryStore } from '../core/store.js';
import { DictionaryResolver } from './resolver.js';
import { MemoryResolutionCache } from './cache.js';
import { genshinFandomProvider, koreanWiktionaryProvider } from './providers/mediawiki.js';
import { OpenDictProvider } from './providers/openDict.js';
import type { LearnHandler, LookupProvider } from './types.js';

export interface ServerResolverOptions {
  /** data/dist 디렉터리. 없으면 빈 사전으로 시작(온라인 프로바이더만 동작). */
  distDir?: string;
  /** 우리말샘 오픈 API 키. 없으면 그 프로바이더는 빠진다. */
  koreanDictApiKey?: string;
  onLearn?: LearnHandler;
}

export async function createServerResolver(
  options: ServerResolverOptions = {},
): Promise<{ resolver: DictionaryResolver; dictionary: DictionaryStore | null }> {
  let dictionary: DictionaryStore | null = null;
  if (options.distDir) {
    try {
      dictionary = await DictionaryStore.load(options.distDir);
    } catch (error) {
      console.warn(
        `[dictionary] ${path.join(options.distDir, 'dictionary.json')} 을 불러오지 못했습니다 — 온라인 검색만으로 동작합니다:`,
        error,
      );
    }
  }

  // 원신 위키(게임 고유명사) -> 국립국어원(키 있을 때만, 일반 어휘 최우선) ->
  // 위키낱말사전(그래도 안 걸리면 최종 폴백) 순서. 먼저 걸리는 프로바이더가
  // 이기므로, 이 순서 자체가 "되도록이면 국립국어원에서만" 을 지킨다.
  const providers: LookupProvider[] = [genshinFandomProvider()];
  if (options.koreanDictApiKey) {
    providers.push(new OpenDictProvider({ apiKey: options.koreanDictApiKey }));
  }
  providers.push(koreanWiktionaryProvider());

  const resolver = new DictionaryResolver({
    ...(dictionary ? { dictionary } : {}),
    providers,
    cache: new MemoryResolutionCache(),
    ...(options.onLearn ? { onLearn: options.onLearn } : {}),
  });

  return { resolver, dictionary };
}
