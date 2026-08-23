import { describe, expect, it } from 'vitest';
import { expandSeedEntry } from '../src/sources/seedSource.js';
import { registerBuiltinSources } from '../src/sources/index.js';
import { allSources, resolveSources } from '../src/sources/registry.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';

registerBuiltinSources();

describe('시드 전개', () => {
  it('문자열 항목에 소스 기본 lore 를 붙인다', () => {
    expect([...expandSeedEntry('벤티', 'genshin', '원신')]).toEqual([
      { word: '벤티', source: 'genshin', lore: '원신' },
    ]);
  });

  it('별칭을 독립 엔트리로 편다', () => {
    const entries = [...expandSeedEntry({ word: '모락스', aliases: ['종려'] }, 'genshin', '원신')];
    expect(entries.map((entry) => entry.word)).toEqual(['모락스', '종려']);
    expect(entries[1]?.extra).toEqual({ aliasOf: '모락스' });
  });

  it('항목별 lore 가 소스 기본값을 이긴다', () => {
    const [entry] = [...expandSeedEntry({ word: '제우스', lore: '그리스 신화' }, 'mythology', '신화')];
    expect(entry?.lore).toBe('그리스 신화');
  });
});

describe('레지스트리', () => {
  it('요구된 소스가 모두 등록돼 있다', () => {
    expect(allSources().map((source) => source.name).sort()).toEqual([
      'anime',
      'ars_goetia',
      'custom',
      'genshin',
      'korean_dict',
      'light_novel',
      'movie',
      'mythology',
      'wikipedia',
    ]);
  });

  it('우선순위 순으로 정렬해 돌려준다', () => {
    const config = {
      ...DEFAULT_CONFIG,
      sources: {
        custom: { enabled: true, priority: 0 },
        genshin: { enabled: true, priority: 10 },
        korean_dict: { enabled: true, priority: 90 },
      },
    };
    const names = resolveSources(config, ['korean_dict', 'custom', 'genshin']).map((s) => s.name);
    expect(names).toEqual(['custom', 'genshin', 'korean_dict']);
  });

  it('비활성 소스를 제외한다', () => {
    const config = {
      ...DEFAULT_CONFIG,
      sources: { genshin: { enabled: false, priority: 10 } },
    };
    expect(resolveSources(config).map((s) => s.name)).not.toContain('genshin');
  });

  it('알 수 없는 소스를 지정하면 실패한다', () => {
    expect(() => resolveSources(DEFAULT_CONFIG, ['없는소스'])).toThrow(/알 수 없는 소스/u);
  });
});
