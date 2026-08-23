import { describe, expect, it } from 'vitest';
import { DedupeEngine } from '../src/core/dedupe.js';
import { LoreEngine } from '../src/core/lore.js';

const lore = new LoreEngine({ maxLength: 60, fallback: '일반 어휘' });

describe('DedupeEngine', () => {
  it('같은 단어를 하나로 합치고 sources 를 누적한다', () => {
    const engine = new DedupeEngine();
    expect(engine.add({ word: '모락스', lore: '원신', source: 'genshin', priority: 10 })).toBe(true);
    expect(
      engine.add({ word: '모락스', lore: '악마학', source: 'ars_goetia', priority: 20 }),
    ).toBe(false);

    const [entry] = engine.finalize(lore);
    expect(entry).toEqual({
      word: '모락스',
      normalized: '모락스',
      first: '모',
      last: '스',
      lore: '원신, 악마학',
      sources: ['genshin', 'ars_goetia'],
    });
    expect(engine.merged).toBe(1);
    expect(engine.size).toBe(1);
  });

  it('sources 와 lore 는 소스 우선순위 순으로 정렬된다', () => {
    const engine = new DedupeEngine();
    engine.add({ word: '바르바토스', lore: '악마학', source: 'ars_goetia', priority: 20 });
    engine.add({ word: '바르바토스', lore: '원신', source: 'genshin', priority: 10 });

    const [entry] = engine.finalize(lore);
    expect(entry?.sources).toEqual(['genshin', 'ars_goetia']);
    expect(entry?.lore).toBe('원신, 악마학');
  });

  it('대소문자만 다른 표기는 같은 엔트리로 본다', () => {
    const engine = new DedupeEngine();
    engine.add({ word: '벤티', source: 'genshin', priority: 10 });
    engine.add({ word: '벤티', source: 'custom', priority: 0 });
    expect(engine.size).toBe(1);
  });

  it('출력은 항상 사전순으로 정렬된다', () => {
    const engine = new DedupeEngine();
    for (const word of ['하늘', '가방', '나비']) {
      engine.add({ word, source: 'korean_dict', priority: 90 });
    }
    expect(engine.finalize(lore).map((entry) => entry.word)).toEqual(['가방', '나비', '하늘']);
  });

  it('같은 소스가 같은 단어를 두 번 내놓아도 안전하다', () => {
    const engine = new DedupeEngine();
    engine.add({ word: '벤티', lore: '원신', source: 'genshin', priority: 10 });
    engine.add({ word: '벤티', lore: '원신', source: 'genshin', priority: 10 });
    const [entry] = engine.finalize(lore);
    expect(entry?.sources).toEqual(['genshin']);
    expect(entry?.lore).toBe('원신');
  });
});
