/**
 * 라이트노벨 소스. 작품 제목이 주 대상이다.
 *
 * 제목은 공백이 많아("리 제로부터 시작하는 이세계 생활") 정규화 단계에서
 * 공백이 전부 제거된 형태로 저장된다.
 */
import { MediaWikiSource } from './mediawikiSource.js';
import { KO_WIKIPEDIA_ENDPOINT } from './wikipedia.js';

export class LightNovelSource extends MediaWikiSource {
  constructor() {
    super({
      name: 'light_novel',
      label: '라이트노벨',
      defaultLore: '라이트노벨',
      defaultPriority: 50,
      endpoint: KO_WIKIPEDIA_ENDPOINT,
      loreMode: 'tag',
      depth: 2,
      limit: 3_000,
      categories: ['라이트 노벨', '일본의 라이트 노벨'],
    });
  }
}
