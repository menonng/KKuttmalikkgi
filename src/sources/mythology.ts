/**
 * 신화 소스. 그리스/북유럽/이집트/한국 신화의 신·영웅·괴물을 모은다.
 *
 * lore 는 계통별로 다르므로("그리스 신화", "북유럽 신화") 시드 항목이
 * 각자 lore 를 들고 있고, 위키 수집분은 소스 기본 태그 "신화"를 받는다.
 */
import { MediaWikiSource } from './mediawikiSource.js';
import { KO_WIKIPEDIA_ENDPOINT } from './wikipedia.js';

export class MythologySource extends MediaWikiSource {
  constructor() {
    super({
      name: 'mythology',
      label: '신화',
      defaultLore: '신화',
      defaultPriority: 30,
      endpoint: KO_WIKIPEDIA_ENDPOINT,
      loreMode: 'tag',
      depth: 2,
      limit: 4_000,
      categories: [
        '그리스 신화의 인물',
        '그리스 신화의 신',
        '북유럽 신화의 신',
        '이집트 신화의 신',
        '한국 신화',
      ],
    });
  }
}
