import { describe, expect, it } from 'vitest';
import { classifyLore, pickLore } from '../src/service/loreClassifier.js';

describe('classifyLore', () => {
  it('그리스 신화 요약을 태그로 압축한다', () => {
    expect(classifyLore('헤파이스토스는 그리스 신화에 나오는 불과 대장장이의 신이다.')).toBe(
      '그리스 신화',
    );
  });

  it('원신 요약을 태그로 압축한다', () => {
    expect(classifyLore('벤티는 원신에 등장하는 몬드의 바람의 신이다.')).toBe('원신');
  });

  it('아르스 고에티아 요약을 악마학으로 분류한다', () => {
    expect(classifyLore('바엘은 솔로몬의 72 악마 중 첫 번째로 등장한다.')).toBe('악마학');
  });

  it('분류 규칙에 안 걸리면 null 을 돌려준다', () => {
    expect(classifyLore('이것은 아무 계통도 언급하지 않는 문장이다.')).toBeNull();
  });

  it('빈 입력은 null', () => {
    expect(classifyLore(undefined)).toBeNull();
    expect(classifyLore('')).toBeNull();
  });
});

describe('pickLore', () => {
  it('분류에 성공하면 태그를 우선한다', () => {
    expect(pickLore('오디세우스는 그리스 신화의 영웅이다.', '위키백과')).toBe('그리스 신화');
  });

  it('분류 실패시 요약 원문을 쓴다', () => {
    expect(pickLore('알루미늄으로 만든 간이 침대.', '일반 어휘')).toBe(
      '알루미늄으로 만든 간이 침대.',
    );
  });

  it('요약도 없으면 폴백을 쓴다', () => {
    expect(pickLore(undefined, '원신')).toBe('원신');
  });
});
