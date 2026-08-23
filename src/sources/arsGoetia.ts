/**
 * 아르스 고에티아(72 악마) 소스.
 *
 * 목록 자체가 72개로 고정이라 시드가 사실상 완전판이고,
 * 온라인에서는 위키백과 악마 분류로 표기 변형을 보강한다.
 */
import { MediaWikiSource } from './mediawikiSource.js';
import { KO_WIKIPEDIA_ENDPOINT } from './wikipedia.js';

export class ArsGoetiaSource extends MediaWikiSource {
  constructor() {
    super({
      name: 'ars_goetia',
      label: '아르스 고에티아',
      defaultLore: '악마학',
      defaultPriority: 20,
      endpoint: KO_WIKIPEDIA_ENDPOINT,
      loreMode: 'tag',
      depth: 1,
      limit: 500,
      categories: ['악마', '기독교 악마'],
    });
  }
}
