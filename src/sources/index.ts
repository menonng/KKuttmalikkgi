/**
 * 모든 소스를 등록하는 지점.
 *
 * 새 소스를 만들면 여기 한 줄만 추가하면 파이프라인/CLI/통계에 자동 반영된다.
 */
import { registerSource } from './registry.js';
import { KoreanDictSource } from './koreanDict.js';
import { WikipediaSource } from './wikipedia.js';
import { MythologySource } from './mythology.js';
import { ArsGoetiaSource } from './arsGoetia.js';
import { GenshinSource } from './genshin.js';
import { AnimeSource } from './anime.js';
import { LightNovelSource } from './lightNovel.js';
import { MovieSource } from './movie.js';
import { CustomSource } from './custom.js';

let registered = false;

/** 기본 소스 세트를 레지스트리에 등록한다(중복 호출 안전). */
export function registerBuiltinSources(): void {
  if (registered) return;
  registered = true;

  registerSource(new CustomSource());
  registerSource(new GenshinSource());
  registerSource(new ArsGoetiaSource());
  registerSource(new MythologySource());
  registerSource(new AnimeSource());
  registerSource(new LightNovelSource());
  registerSource(new MovieSource());
  registerSource(new WikipediaSource());
  registerSource(new KoreanDictSource());
}

export * from './types.js';
export * from './registry.js';
export * from './seedSource.js';
export * from './mediawikiSource.js';
export { KoreanDictSource } from './koreanDict.js';
export { WikipediaSource } from './wikipedia.js';
export { MythologySource } from './mythology.js';
export { ArsGoetiaSource } from './arsGoetia.js';
export { GenshinSource } from './genshin.js';
export { AnimeSource } from './anime.js';
export { LightNovelSource } from './lightNovel.js';
export { MovieSource } from './movie.js';
export { CustomSource, appendCustomEntry } from './custom.js';
