import { describe, expect, it } from 'vitest';
import { LoreEngine } from '../src/core/lore.js';

const engine = new LoreEngine({ maxLength: 60, fallback: '일반 어휘' });

describe('LoreEngine', () => {
  it('여러 소스의 태그를 우선순위 순으로 잇는다', () => {
    expect(engine.merge(['원신', '악마학'])).toBe('원신, 악마학');
  });

  it('같은 태그를 중복해서 넣지 않는다', () => {
    expect(engine.merge(['원신', '원신', '악마학'])).toBe('원신, 악마학');
  });

  it('포함 관계인 태그는 더 구체적인 쪽만 남긴다', () => {
    expect(engine.merge(['원신', '원신 캐릭터'])).toBe('원신 캐릭터');
  });

  it('사전 뜻풀이를 그대로 유지한다', () => {
    expect(engine.merge(['주로 알루미늄을 뼈대로 하는 간이 침대.'])).toBe(
      '주로 알루미늄을 뼈대로 하는 간이 침대.',
    );
  });

  it('위키 각주와 번호 매김을 걷어낸다', () => {
    expect(engine.clean('1. 개의 새끼.[1]')).toBe('개의 새끼.');
  });

  it('길이 예산을 넘으면 잘라내고 말줄임표를 붙인다', () => {
    const long = '가'.repeat(80);
    const result = engine.merge([long]);
    expect(result.length).toBeLessThanOrEqual(60);
    expect(result.endsWith('…')).toBe(true);
  });

  it('예산을 넘기면 우선순위가 낮은 조각부터 버린다', () => {
    const result = engine.merge(['원신', '가'.repeat(55), '악마학']);
    expect(result.startsWith('원신')).toBe(true);
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('아무 것도 없으면 대체값을 쓴다', () => {
    expect(engine.merge([undefined, null, '   '])).toBe('일반 어휘');
  });
});
