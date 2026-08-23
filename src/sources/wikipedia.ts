/**
 * 한국어 위키백과 소스.
 *
 * 역사적 인물 / 조직 / 지명 같은 일반 고유명사를 담당한다.
 * 이 소스만 lore 를 문서 요약(extract)에서 뽑는다 — 태그 하나로 뭉뚱그리기엔
 * 대상이 너무 넓기 때문이다.
 */
import { MediaWikiSource } from './mediawikiSource.js';

export const KO_WIKIPEDIA_ENDPOINT = 'https://ko.wikipedia.org/w/api.php';

export class WikipediaSource extends MediaWikiSource {
  constructor() {
    super({
      name: 'wikipedia',
      label: '위키백과',
      defaultLore: '위키백과',
      defaultPriority: 80,
      endpoint: KO_WIKIPEDIA_ENDPOINT,
      loreMode: 'extract',
      depth: 1,
      limit: 5_000,
      categories: [
        '한국의 역사적 인물',
        '조선의 왕',
        '고구려의 왕',
        '대한민국의 도시',
        '나라',
        '국제 기구',
      ],
    });
  }
}
