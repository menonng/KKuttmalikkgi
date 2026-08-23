/**
 * 영화/TV 시리즈 제목 소스.
 */
import { MediaWikiSource } from './mediawikiSource.js';
import { KO_WIKIPEDIA_ENDPOINT } from './wikipedia.js';

export class MovieSource extends MediaWikiSource {
  constructor() {
    super({
      name: 'movie',
      label: '영화·드라마',
      defaultLore: '영화',
      defaultPriority: 60,
      endpoint: KO_WIKIPEDIA_ENDPOINT,
      loreMode: 'tag',
      depth: 2,
      limit: 5_000,
      categories: ['대한민국의 영화 작품', '한국의 텔레비전 드라마'],
    });
  }
}
