/**
 * 서버 사이드 리졸버 조립기.
 *
 * 브라우저판과 달리 우리말샘 오픈 API(키 필요)를 더해 일반 어휘 판정을 보강하고,
 * 빌드 산출물은 디스크에서 직접 읽는다(DictionaryStore, node:fs 사용).
 */
import path from 'node:path';
import { DictionaryStore } from '../core/store.js';
import { DictionaryResolver } from './resolver.js';
import { MemoryResolutionCache } from './cache.js';
import { genshinFandomProvider, koreanWikipediaProvider, koreanWiktionaryProvider } from './providers/mediawiki.js';
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

  const providers: LookupProvider[] = [
    genshinFandomProvider(),
    koreanWikipediaProvider(),
    koreanWiktionaryProvider(),
  ];
  if (options.koreanDictApiKey) {
    providers.push(new OpenDictProvider({ apiKey: options.koreanDictApiKey }));
  }

  const resolver = new DictionaryResolver({
    ...(dictionary ? { dictionary } : {}),
    providers,
    cache: new MemoryResolutionCache(),
    ...(options.onLearn ? { onLearn: options.onLearn } : {}),
  });

  return { resolver, dictionary };
}
