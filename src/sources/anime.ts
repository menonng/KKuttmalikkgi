/**
 * 애니메이션/만화 등장인물 소스.
 * 작품명은 lightNovel/movie 소스가, 인물은 이 소스가 담당한다.
 */
import { MediaWikiSource } from './mediawikiSource.js';
import { KO_WIKIPEDIA_ENDPOINT } from './wikipedia.js';

export class AnimeSource extends MediaWikiSource {
  constructor() {
    super({
      name: 'anime',
      label: '애니메이션',
      defaultLore: '애니메이션',
      defaultPriority: 40,
      endpoint: KO_WIKIPEDIA_ENDPOINT,
      loreMode: 'tag',
      depth: 2,
      limit: 5_000,
      categories: ['애니메이션 등장인물', '만화 등장인물'],
    });
  }
}
