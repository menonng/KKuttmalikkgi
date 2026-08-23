/**
 * 원신 소스. 팬덤 위키는 위키백과와 같은 MediaWiki API 를 제공한다.
 *
 * 캐릭터의 본명/이명이 모두 유효한 단어라서(모락스=종려) 시드에서
 * aliases 로 묶어두면 전개 단계에서 각각 독립 엔트리가 된다.
 */
import { MediaWikiSource } from './mediawikiSource.js';

export class GenshinSource extends MediaWikiSource {
  constructor() {
    super({
      name: 'genshin',
      label: '원신',
      defaultLore: '원신',
      defaultPriority: 10,
      endpoint: 'https://genshin-impact.fandom.com/ko/api.php',
      loreMode: 'tag',
      depth: 1,
      limit: 2_000,
      categories: ['캐릭터', '지역', '무기'],
    });
  }
}
